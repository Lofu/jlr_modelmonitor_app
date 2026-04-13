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
    <Space direction="vertical" style={{ width: '100%' }} size="large">

      {/* ── 選擇執行版本 ── */}
      <Card
        title={<Space><BarChartOutlined /><span>選擇分析對象</span></Space>}
        extra={
          <Space>
            <Text type="secondary" style={{ fontSize: 13 }}>
              已選 <Text strong style={{ color: '#00873e' }}>{selectedRunIds.length}</Text> / {runs.length} 筆
            </Text>
            <Button size="small" onClick={() => setSelectedRunIds(runs.map((r) => r.run_id))}>全選</Button>
            <Button size="small" onClick={() => setSelectedRunIds([])}>清除</Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadRuns} loading={loading}>重新整理</Button>
          </Space>
        }
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin tip="載入中..." /></div>
        ) : runs.length === 0 ? (
          <Alert
            message="尚無執行紀錄"
            description="請先在「PDF 萃取」頁面執行萃取，或在「檔案管理」頁面匯入 CSV。"
            type="warning" showIcon
          />
        ) : (
          <Row gutter={[12, 12]}>
            {runs.map((run) => {
              const selected = selectedRunIds.includes(run.run_id)
              return (
                <Col xs={24} sm={12} xl={8} key={run.run_id}>
                  <Card
                    size="small"
                    style={{
                      border: selected ? '2px solid #00873e' : '1px solid #e8e8e8',
                      background: selected ? '#f6ffed' : '#fafafa',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onClick={() => toggleRun(run.run_id, !selected)}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Row justify="space-between" align="top">
                        <Col>
                          <Space size={6}>
                            {getProviderTag(run.provider)}
                            <Text strong style={{ fontSize: 14 }}>{run.model_id}</Text>
                          </Space>
                        </Col>
                        <Col>
                          <Checkbox checked={selected} onChange={(e) => { e.stopPropagation(); toggleRun(run.run_id, e.target.checked) }} />
                        </Col>
                      </Row>
                      <Row gutter={16}>
                        <Col>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            成功 <Text strong style={{ color: '#00873e' }}>{run.success_count}</Text> / {run.total_files} 筆
                          </Text>
                        </Col>
                        <Col>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {dayjs(run.started_at).format('YYYY-MM-DD HH:mm')}
                          </Text>
                        </Col>
                      </Row>
                      {run.prompt_preview && (
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', lineHeight: 1.4 }}>
                          {run.prompt_preview.slice(0, 60)}{run.prompt_preview.length > 60 ? '…' : ''}
                        </Text>
                      )}
                      <Text type="secondary" style={{ fontSize: 11, color: '#bfbfbf' }}>
                        run: {run.run_id.slice(0, 8)}
                      </Text>
                    </Space>
                  </Card>
                </Col>
              )
            })}
          </Row>
        )}
      </Card>

      {/* ── 開始分析按鈕 ── */}
      <Row justify="end">
        <Col>
          <Button
            type="primary"
            onClick={handleAnalyze}
            loading={analyzing}
            icon={<BarChartOutlined />}
            size="large"
            disabled={selectedRunIds.length === 0}
            style={{ minWidth: 160, background: '#00873e', borderColor: '#00873e' }}
          >
            {analyzing ? '分析中...' : '開始分析'}
          </Button>
        </Col>
      </Row>

      {analyzing && (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Spin size="large" tip="正在從 BigQuery 取得資料並計算準確度..." />
        </div>
      )}

      {/* ── 分析結果 ── */}
      {result && !analyzing && (
        <Space direction="vertical" style={{ width: '100%' }} size="large">

          {/* 整體統計 */}
          {overallStats && (
            <Card title={<Space><CheckCircleOutlined style={{ color: '#00873e' }} /><span>整體準確度統計</span><Text type="secondary" style={{ fontSize: 13 }}>（共 {result.total_records} 筆記錄）</Text></Space>}>
              <Row gutter={[16, 16]}>
                {result.model_names.map((modelId: string) => (
                  <Col xs={24} sm={12} key={modelId}>
                    <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                      <Text strong style={{ fontSize: 14, color: '#00873e', display: 'block', marginBottom: 12 }}>
                        {result.model_display_names[modelId] || modelId}
                      </Text>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Statistic
                            title="平均完全一致率"
                            value={overallStats[modelId].avgExactMatch}
                            suffix="%"
                            valueStyle={{ color: '#3f8600', fontSize: 28 }}
                            prefix={<CheckCircleOutlined />}
                          />
                        </Col>
                        <Col span={12}>
                          <Statistic
                            title="平均相似度"
                            value={overallStats[modelId].avgSimilarity}
                            suffix="%"
                            valueStyle={{ fontSize: 28 }}
                          />
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Card>
          )}

          {/* 長條圖 */}
          <Card title="各欄位準確度比較（完全一致率）">
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="field" tick={{ fontSize: 13 }} />
                <YAxis
                  label={{ value: '完全一致率 (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip formatter={(value: any) => `${value}%`} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                {result.model_names.map((modelId: string, index: number) => (
                  <Bar
                    key={modelId}
                    dataKey={modelId}
                    fill={colors[index % colors.length]}
                    name={result.model_display_names[modelId] || modelId}
                    radius={[3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* 詳細數據表 */}
          <Card
            title="詳細準確度數據"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                綠色 ≥80%　橙色 60–80%　紅色 &lt;60%　｜　Jaccard 相似度
              </Text>
            }
          >
            <Table
              columns={tableColumns}
              dataSource={tableData}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="middle"
              bordered
            />
          </Card>
        </Space>
      )}
    </Space>
  )
}

export default AnalyzePage
