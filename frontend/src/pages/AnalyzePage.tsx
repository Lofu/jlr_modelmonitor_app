import { useState, useEffect } from 'react'
import {
  Card,
  Button,
  Table,
  Space,
  Row,
  Col,
  Statistic,
  Alert,
  message,
  Spin,
  Checkbox,
  Divider,
  Typography,
  Tag,
} from 'antd'
import {
  BarChartOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { listBQRuns, analyzeAccuracyBQ, type BQRun } from '../services/api'
import dayjs from 'dayjs'

const { Text } = Typography

const getProviderTag = (provider: string) => {
  const p = provider?.toLowerCase() || ''
  if (p === 'gemini') return <Tag color="blue">Gemini</Tag>
  if (p === 'claude') return <Tag color="purple">Claude</Tag>
  return <Tag>{provider || 'Unknown'}</Tag>
}

const AnalyzePage = () => {
  const [runs, setRuns] = useState<BQRun[]>([])
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    loadRuns()
  }, [])

  const loadRuns = async () => {
    try {
      setLoading(true)
      const data = await listBQRuns()
      setRuns(data)
      if (data.length > 0 && selectedRunIds.length === 0) {
        setSelectedRunIds(data.map((r) => r.run_id))
      }
    } catch (error) {
      message.error('載入 BQ 執行紀錄失敗，請確認 BigQuery 連線設定')
    } finally {
      setLoading(false)
    }
  }

  const toggleRun = (runId: string, checked: boolean) => {
    if (checked) {
      setSelectedRunIds((prev) => [...prev, runId])
    } else {
      setSelectedRunIds((prev) => prev.filter((id) => id !== runId))
    }
  }

  const handleAnalyze = async () => {
    if (selectedRunIds.length === 0) {
      message.warning('請至少選擇一個執行版本')
      return
    }
    try {
      setAnalyzing(true)
      const data = await analyzeAccuracyBQ({ run_ids: selectedRunIds })
      if (data.success) {
        setResult(data)
        message.success('分析完成！')
      } else {
        throw new Error('分析失敗')
      }
    } catch (error: any) {
      message.error(error.message || '分析失敗')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── 圖表資料 ──────────────────────────────────────────────────────────────
  const prepareChartData = () => {
    if (!result?.accuracy_summary) return []
    const fields = ['NAME', 'SEX', 'DATE_OF_BIRTH', 'PLACE_OF_BIRTH']
    const fieldNames: Record<string, string> = {
      NAME: '姓名', SEX: '性別', DATE_OF_BIRTH: '生日', PLACE_OF_BIRTH: '出生地',
    }
    return fields.map((field) => {
      const row: any = { field: fieldNames[field] || field, fieldEn: field }
      result.model_names.forEach((modelId: string) => {
        const rec = result.accuracy_summary.find(
          (r: any) => r['模型'] === modelId && r['欄位'] === field
        )
        row[modelId] = rec ? (rec['完全一致率'] * 100).toFixed(2) : 0
      })
      return row
    })
  }

  // ── 表格資料 ──────────────────────────────────────────────────────────────
  const prepareTableData = () => {
    if (!result?.accuracy_summary) return []
    const fields = ['NAME', 'SEX', 'DATE_OF_BIRTH', 'DATE_OF_BIRTH_YEAR', 'PLACE_OF_BIRTH']
    const fieldNames: Record<string, string> = {
      NAME: '姓名', SEX: '性別', DATE_OF_BIRTH: '生日',
      DATE_OF_BIRTH_YEAR: '生日(年)', PLACE_OF_BIRTH: '出生地',
    }
    return fields.map((field) => {
      const row: any = { key: field, field: fieldNames[field] || field }
      result.model_names.forEach((modelId: string) => {
        const rec = result.accuracy_summary.find(
          (r: any) => r['模型'] === modelId && r['欄位'] === field
        )
        if (rec) {
          row[`${modelId}_exact`] = `${(rec['完全一致率'] * 100).toFixed(2)}%`
          row[`${modelId}_avg`] = `${(rec['平均相似度'] * 100).toFixed(2)}%`
          row[`${modelId}_count`] = `${rec['完全一致數']}/${rec['總筆數']}`
        } else {
          row[`${modelId}_exact`] = 'N/A'
          row[`${modelId}_avg`] = 'N/A'
          row[`${modelId}_count`] = 'N/A'
        }
      })
      return row
    })
  }

  const tableColumns = [
    { title: '欄位', dataIndex: 'field', key: 'field', fixed: 'left' as const, width: 120 },
    ...(result?.model_names || []).flatMap((modelId: string) => [
      {
        title: `${modelId} (完全一致率)`,
        dataIndex: `${modelId}_exact`,
        key: `${modelId}_exact`,
        width: 180,
        render: (value: string) => {
          const pct = parseFloat(value)
          if (isNaN(pct)) return value
          return (
            <span style={{ color: pct >= 80 ? '#3f8600' : pct >= 60 ? '#fa8c16' : '#cf1322', fontWeight: 'bold' }}>
              {value}
            </span>
          )
        },
      },
      { title: `${modelId} (平均相似度)`, dataIndex: `${modelId}_avg`, key: `${modelId}_avg`, width: 180 },
      { title: `${modelId} (成功/總數)`, dataIndex: `${modelId}_count`, key: `${modelId}_count`, width: 160 },
    ]),
  ]

  const calculateOverallStats = () => {
    if (!result?.accuracy_summary) return null
    const stats: Record<string, any> = {}
    result.model_names.forEach((modelId: string) => {
      const recs = result.accuracy_summary.filter((r: any) => r['模型'] === modelId)
      const avgExact = recs.reduce((s: number, r: any) => s + (r['完全一致率'] || 0), 0) / recs.length
      const avgSim = recs.reduce((s: number, r: any) => s + (r['平均相似度'] || 0), 0) / recs.length
      stats[modelId] = {
        avgExactMatch: (avgExact * 100).toFixed(2),
        avgSimilarity: (avgSim * 100).toFixed(2),
      }
    })
    return stats
  }

  const chartData = prepareChartData()
  const tableData = prepareTableData()
  const overallStats = calculateOverallStats()
  const colors = ['#1890ff', '#52c41a', '#fa8c16', '#f5222d', '#722ed1', '#13c2c2']

  return (
    <div>
      <Card
        title={
          <Space>
            <BarChartOutlined />
            <span>準確度分析</span>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">

          {/* ── 選擇 BQ 執行版本 ── */}
          <div>
            <Divider orientation="left">
              <Space>
                📦 選擇要分析的 BQ 執行版本
                <Button size="small" icon={<ReloadOutlined />} onClick={loadRuns} loading={loading}>
                  重新整理
                </Button>
              </Space>
            </Divider>

            {loading ? (
              <Spin tip="載入中..." />
            ) : runs.length === 0 ? (
              <Alert
                message="尚無執行紀錄"
                description="請先在「PDF 萃取」頁面執行萃取，或在「檔案管理」頁面匯入現有 JSONL 歷史資料。"
                type="warning"
                showIcon
              />
            ) : (
              <>
                <Row gutter={16} style={{ marginBottom: 12 }} align="middle">
                  <Col>
                    <Text type="secondary">
                      已選 <Text strong style={{ color: '#00873e' }}>{selectedRunIds.length}</Text> / {runs.length} 筆
                    </Text>
                  </Col>
                  <Col>
                    <Space>
                      <Button size="small" onClick={() => setSelectedRunIds(runs.map((r) => r.run_id))}>
                        全選
                      </Button>
                      <Button size="small" danger onClick={() => setSelectedRunIds([])}>
                        清除
                      </Button>
                    </Space>
                  </Col>
                </Row>

                <Row gutter={[12, 12]}>
                  {runs.map((run) => {
                    const selected = selectedRunIds.includes(run.run_id)
                    return (
                      <Col span={12} key={run.run_id}>
                        <Card
                          size="small"
                          style={{
                            border: selected ? '2px solid #00873e' : '1px solid #d9d9d9',
                            background: selected ? 'rgba(0,135,62,0.04)' : 'transparent',
                            cursor: 'pointer',
                          }}
                          onClick={() => toggleRun(run.run_id, !selected)}
                        >
                          <Checkbox
                            checked={selected}
                            onChange={(e) => toggleRun(run.run_id, e.target.checked)}
                            style={{ width: '100%' }}
                          >
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              <Space>
                                {getProviderTag(run.provider)}
                                <Text strong style={{ fontSize: 13 }}>{run.model_id}</Text>
                              </Space>
                              <Row gutter={12}>
                                <Col>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    ✅ {run.success_count} / {run.total_files} 筆
                                  </Text>
                                </Col>
                                <Col>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    🕒 {dayjs(run.started_at).format('MM-DD HH:mm')}
                                  </Text>
                                </Col>
                              </Row>
                              {run.prompt_preview && (
                                <Text type="secondary" style={{ fontSize: 10, color: '#9ca3af', display: 'block' }}>
                                  📝 {run.prompt_preview.slice(0, 50)}{run.prompt_preview.length > 50 ? '…' : ''}
                                </Text>
                              )}
                              <Text type="secondary" style={{ fontSize: 10, color: '#bfbfbf' }}>
                                run: {run.run_id.slice(0, 8)}
                              </Text>
                            </Space>
                          </Checkbox>
                        </Card>
                      </Col>
                    )
                  })}
                </Row>
              </>
            )}
          </div>

          {/* ── 開始分析按鈕 ── */}
          <Button
            type="primary"
            onClick={handleAnalyze}
            loading={analyzing}
            icon={<BarChartOutlined />}
            size="large"
            block
            disabled={selectedRunIds.length === 0}
          >
            {analyzing ? '分析中...' : '🔍 開始分析'}
          </Button>

          {analyzing && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin size="large" tip="正在從 BigQuery 取得資料並計算準確度..." />
            </div>
          )}

          {/* ── 分析結果 ── */}
          {result && !analyzing && (
            <>
              {overallStats && (
                <>
                  <Divider orientation="left">📈 整體準確度統計</Divider>
                  <Alert
                    message={`分析了 ${result.total_records} 筆記錄`}
                    description={
                      <Row gutter={16} style={{ marginTop: 16 }}>
                        {result.model_names.map((modelId: string) => (
                          <Col span={12} key={modelId}>
                            <Card size="small" style={{ marginBottom: 16 }}>
                              <h4 style={{ color: '#00873e', marginBottom: 12 }}>
                                {result.model_display_names[modelId] || modelId}
                              </h4>
                              <Row gutter={16}>
                                <Col span={12}>
                                  <Statistic
                                    title="平均完全一致率"
                                    value={overallStats[modelId].avgExactMatch}
                                    suffix="%"
                                    valueStyle={{ color: '#3f8600', fontSize: 24 }}
                                    prefix={<CheckCircleOutlined />}
                                  />
                                </Col>
                                <Col span={12}>
                                  <Statistic
                                    title="平均相似度"
                                    value={overallStats[modelId].avgSimilarity}
                                    suffix="%"
                                    valueStyle={{ fontSize: 24 }}
                                    prefix={<CheckCircleOutlined />}
                                  />
                                </Col>
                              </Row>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    }
                    type="info"
                  />
                </>
              )}

              <Card title="各欄位準確度比較（完全一致率）" size="small" style={{ marginTop: 24 }}>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="field" />
                    <YAxis
                      label={{ value: '完全一致率 (%)', angle: -90, position: 'insideLeft' }}
                      domain={[0, 100]}
                    />
                    <Tooltip formatter={(value: any) => `${value}%`} />
                    <Legend />
                    {result.model_names.map((modelId: string, index: number) => (
                      <Bar
                        key={modelId}
                        dataKey={modelId}
                        fill={colors[index % colors.length]}
                        name={result.model_display_names[modelId] || modelId}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="詳細準確度數據" size="small" style={{ marginTop: 24 }}>
                <Alert
                  message="說明"
                  description={
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      <li>完全一致率：與 Ground Truth 完全相同的比例</li>
                      <li>平均相似度：使用 Jaccard 相似度算法計算</li>
                      <li>綠色 (≥80%)、橙色 (60–80%)、紅色 (&lt;60%)</li>
                    </ul>
                  }
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Table
                  columns={tableColumns}
                  dataSource={tableData}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  size="small"
                  bordered
                />
              </Card>
            </>
          )}
        </Space>
      </Card>
    </div>
  )
}

export default AnalyzePage
