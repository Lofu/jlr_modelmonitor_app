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
  Typography
} from 'antd'
import {
  BarChartOutlined,
  CheckCircleOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { listModels, analyzeAccuracy, type ModelInfo } from '../services/api'
import dayjs from 'dayjs'

const { Text } = Typography

const AnalyzePage = () => {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [groundTruthStatus, setGroundTruthStatus] = useState<{ exists: boolean, count?: number } | null>(null)

  useEffect(() => {
    loadModels()
    checkGroundTruth()
  }, [])

  const checkGroundTruth = async () => {
    try {
      const config = await import('../services/api').then(m => m.getConfig())
      setGroundTruthStatus({
        exists: config.ground_truth_exists,
        count: undefined  // 後端可以額外提供記錄數
      })
    } catch (error) {
      console.error('檢查基準資料失敗:', error)
    }
  }

  const loadModels = async () => {
    try {
      setLoading(true)
      const data = await listModels()
      setModels(data)

      // 預設全選
      if (data.length > 0) {
        setSelectedModels(data.map(m => m.file_name))
      }
    } catch (error) {
      message.error('載入模型列表失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleCheckboxChange = (fileName: string, checked: boolean) => {
    if (checked) {
      setSelectedModels([...selectedModels, fileName])
    } else {
      setSelectedModels(selectedModels.filter(f => f !== fileName))
    }
  }

  const handleSelectAll = () => {
    setSelectedModels(models.map(m => m.file_name))
  }

  const handleDeselectAll = () => {
    setSelectedModels([])
  }

  const handleAnalyze = async () => {
    if (selectedModels.length === 0) {
      message.warning('請至少選擇一個模型')
      return
    }

    try {
      setAnalyzing(true)
      const data = await analyzeAccuracy({ model_files: selectedModels })

      if (data.success) {
        setResult(data)
        message.success('分析完成！')
      } else {
        throw new Error('分析失敗')
      }
    } catch (error: any) {
      message.error(error.message || '分析失敗')
      console.error('分析錯誤:', error)
    } finally {
      setAnalyzing(false)
    }
  }

  // 準備圖表資料 - 使用完全一致率
  const prepareChartData = () => {
    if (!result || !result.accuracy_summary) return []

    const fields = ['NAME', 'SEX', 'DATE_OF_BIRTH', 'PLACE_OF_BIRTH']
    const fieldNames: Record<string, string> = {
      'NAME': '姓名',
      'SEX': '性別',
      'DATE_OF_BIRTH': '生日',
      'PLACE_OF_BIRTH': '出生地'
    }

    const chartData = fields.map(field => {
      const fieldData: any = {
        field: fieldNames[field] || field,
        fieldEn: field
      }

      result.model_names.forEach((modelId: string) => {
        // 找到對應的資料
        const record = result.accuracy_summary.find(
          (r: any) => r['模型'] === modelId && r['欄位'] === field
        )
        if (record) {
          fieldData[modelId] = (record['完全一致率'] * 100).toFixed(2)
        } else {
          fieldData[modelId] = 0
        }
      })

      return fieldData
    })

    return chartData
  }

  // 準備表格資料
  const prepareTableData = () => {
    if (!result || !result.accuracy_summary) return []

    const fields = ['NAME', 'SEX', 'DATE_OF_BIRTH', 'DATE_OF_BIRTH_YEAR', 'PLACE_OF_BIRTH']
    const fieldNames: Record<string, string> = {
      'NAME': '姓名',
      'SEX': '性別',
      'DATE_OF_BIRTH': '生日',
      'DATE_OF_BIRTH_YEAR': '生日(年)',
      'PLACE_OF_BIRTH': '出生地'
    }

    return fields.map(field => {
      const row: any = {
        key: field,
        field: fieldNames[field] || field,
      }

      result.model_names.forEach((modelId: string) => {
        const record = result.accuracy_summary.find(
          (r: any) => r['模型'] === modelId && r['欄位'] === field
        )
        if (record) {
          row[`${modelId}_exact`] = `${(record['完全一致率'] * 100).toFixed(2)}%`
          row[`${modelId}_avg`] = `${(record['平均相似度'] * 100).toFixed(2)}%`
          row[`${modelId}_count`] = `${record['完全一致數']}/${record['總筆數']}`
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
    {
      title: '欄位',
      dataIndex: 'field',
      key: 'field',
      fixed: 'left' as const,
      width: 120,
    },
    ...(result?.model_names || []).flatMap((modelId: string) => [
      {
        title: `${modelId} (完全一致率)`,
        dataIndex: `${modelId}_exact`,
        key: `${modelId}_exact`,
        width: 180,
        render: (value: string) => {
          const percent = parseFloat(value)
          if (isNaN(percent)) return value
          return (
            <span style={{
              color: percent >= 80 ? '#3f8600' : percent >= 60 ? '#fa8c16' : '#cf1322',
              fontWeight: 'bold'
            }}>
              {value}
            </span>
          )
        }
      },
      {
        title: `${modelId} (平均相似度)`,
        dataIndex: `${modelId}_avg`,
        key: `${modelId}_avg`,
        width: 180,
      },
      {
        title: `${modelId} (成功數/總數)`,
        dataIndex: `${modelId}_count`,
        key: `${modelId}_count`,
        width: 160,
      },
    ])
  ]

  const chartData = prepareChartData()
  const tableData = prepareTableData()

  // 計算整體統計
  const calculateOverallStats = () => {
    if (!result || !result.accuracy_summary) return null

    const stats: Record<string, any> = {}

    result.model_names.forEach((modelId: string) => {
      const modelRecords = result.accuracy_summary.filter(
        (r: any) => r['模型'] === modelId
      )

      const avgExactMatch = modelRecords.reduce((sum: number, r: any) =>
        sum + (r['完全一致率'] || 0), 0
      ) / modelRecords.length

      const avgSimilarity = modelRecords.reduce((sum: number, r: any) =>
        sum + (r['平均相似度'] || 0), 0
      ) / modelRecords.length

      stats[modelId] = {
        avgExactMatch: (avgExactMatch * 100).toFixed(2),
        avgSimilarity: (avgSimilarity * 100).toFixed(2),
      }
    })

    return stats
  }

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
          {/* 基準資料狀態 */}
          {groundTruthStatus && (
            groundTruthStatus.exists ? (
              <Alert
                message="✅ 已載入基準資料 (Ground Truth)"
                description={
                  <Text>
                    📁 <Text strong>基準資料路徑：</Text>data/ground_truth/ground_truth.csv
                  </Text>
                }
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
              />
            ) : (
              <Alert
                message="❌ 找不到基準資料"
                description={
                  <div>
                    <Text>請確認檔案是否存在：</Text>
                    <br />
                    <Text code>/Users/algeryang/Documents/CDC/法院判例/ModelChange_Monitor_react/data/ground_truth/ground_truth.csv</Text>
                  </div>
                }
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )
          )}

          <div>
            <Divider orientation="left">📂 選擇要分析的模型萃取結果</Divider>
            <Alert
              message={
                <Text>
                  📁 <Text strong>萃取結果來源路徑：</Text>data/extracts/ 目錄（共找到 {models.length} 個檔案）
                </Text>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />

            {loading ? (
              <Spin tip="載入中..." />
            ) : models.length === 0 ? (
              <Alert
                message="找不到任何萃取結果檔案"
                description={
                  <div>
                    <p>請確認：</p>
                    <ul>
                      <li>檔案命名符合格式：{`{模型ID}_extract_v{版本}.csv`}</li>
                      <li>檔案位於 data/extracts/ 目錄</li>
                      <li>或在「PDF 萃取」頁面執行萃取</li>
                    </ul>
                  </div>
                }
                type="warning"
                showIcon
              />
            ) : (
              <>
                <Card
                  title={
                    <Space>
                      <FileTextOutlined style={{ color: '#00873e' }} />
                      <Text strong>快速選擇</Text>
                    </Space>
                  }
                  size="small"
                  style={{ marginBottom: 16, border: '2px solid #00873e' }}
                  headStyle={{ background: 'linear-gradient(135deg, rgba(0, 135, 62, 0.1) 0%, rgba(255, 213, 0, 0.1) 100%)' }}
                >
                  <Row gutter={16} align="middle">
                    <Col span={12}>
                      <Statistic
                        title="已選擇檔案"
                        value={selectedModels.length}
                        suffix={`/ ${models.length}`}
                        valueStyle={{ color: '#00873e', fontSize: 28 }}
                      />
                    </Col>
                    <Col span={12}>
                      <Space size="middle">
                        <Button
                          type="primary"
                          size="large"
                          onClick={handleSelectAll}
                          icon={<CheckCircleOutlined />}
                          style={{ background: '#00873e' }}
                        >
                          全選 ({models.length})
                        </Button>
                        <Button
                          danger
                          size="large"
                          onClick={handleDeselectAll}
                        >
                          清除選擇
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </Card>

                <Alert
                  message="💡 提示：點擊下方卡片勾選/取消個別檔案，或使用上方按鈕快速全選"
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary">
                    已勾選 <Text strong style={{ color: '#00873e' }}>{selectedModels.length}</Text> 個檔案
                  </Text>
                </div>

                <Row gutter={[16, 16]}>
                  {models.map(model => (
                    <Col span={12} key={model.file_name}>
                      <Card
                        size="small"
                        style={{
                          background: selectedModels.includes(model.file_name)
                            ? 'rgba(0, 135, 62, 0.05)'
                            : 'transparent',
                          border: selectedModels.includes(model.file_name)
                            ? '2px solid #00873e'
                            : '1px solid #d9d9d9'
                        }}
                      >
                        <Checkbox
                          checked={selectedModels.includes(model.file_name)}
                          onChange={(e) => handleCheckboxChange(model.file_name, e.target.checked)}
                          style={{ width: '100%' }}
                        >
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <Text strong><FileTextOutlined /> {model.file_name}</Text>
                            <Row gutter={16}>
                              <Col span={12}>
                                <Text type="secondary">
                                  📊 記錄數: <Text strong style={{ color: '#00873e' }}>{model.record_count}</Text> 筆
                                </Text>
                              </Col>
                              <Col span={12}>
                                <Text type="secondary">
                                  🕒 {dayjs(model.modified_time).format('MM-DD HH:mm')}
                                </Text>
                              </Col>
                            </Row>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              💾 檔案大小: {(model.file_size / 1024).toFixed(1)} KB | 模型: {model.model_id}
                            </Text>
                          </Space>
                        </Checkbox>
                      </Card>
                    </Col>
                  ))}
                </Row>

                {selectedModels.length === 0 && (
                  <Alert
                    message="⚠️ 請至少選擇一個檔案進行分析"
                    type="warning"
                    showIcon
                    style={{ marginTop: 16 }}
                  />
                )}

                {selectedModels.length > 0 && (
                  <Alert
                    message={`✅ 已選擇 ${selectedModels.length} 個檔案`}
                    type="success"
                    showIcon
                    style={{ marginTop: 16 }}
                  />
                )}
              </>
            )}
          </div>

          <Button
            type="primary"
            onClick={handleAnalyze}
            loading={analyzing}
            icon={<BarChartOutlined />}
            size="large"
            block
            disabled={selectedModels.length === 0}
          >
            {analyzing ? '分析中...' : '🔍 開始分析'}
          </Button>

          {analyzing && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin size="large" tip="正在分析準確度..." />
            </div>
          )}

          {result && !analyzing && (
            <>
              {/* 整體統計 */}
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

              {/* 圖表 */}
              <Card
                title="各欄位準確度比較（完全一致率）"
                size="small"
                style={{ marginTop: 24 }}
              >
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

              {/* 詳細表格 */}
              <Card
                title="詳細準確度數據"
                size="small"
                style={{ marginTop: 24 }}
              >
                <Alert
                  message="💡 說明"
                  description={
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      <li>完全一致率：與基準資料完全相同的比例</li>
                      <li>平均相似度：使用 Jaccard 相似度等算法計算的平均相似度</li>
                      <li>成功數/總數：完全匹配的記錄數 / 總記錄數</li>
                      <li>綠色 (≥80%)、橙色 (60-80%)、紅色 (&lt;60%)</li>
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
