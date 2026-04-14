import { useState, useEffect, useRef } from 'react'
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Progress,
  Alert,
  Space,
  Statistic,
  Row,
  Col,
  Divider,
  message,
  Collapse,
  Checkbox,
  Slider,
  Tag,
  Typography
} from 'antd'
import {
  RocketOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  HourglassOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { extractPdfs, createWebSocket, getConfig, listPdfFiles, type ExtractRequest, type ConfigInfo } from '../services/api'

const { TextArea } = Input
const { Text } = Typography

const QUICK_SELECT_OPTIONS = [
  { label: '測試', count: 5 },
  { label: '小批次', count: 20 },
  { label: '中批次', count: 50 },
]

const ExtractPage = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [result, setResult] = useState<any>(null)
  const [config, setConfig] = useState<ConfigInfo | null>(null)
  const [pdfFiles, setPdfFiles] = useState<any[]>([])
  const [selectedPdfFiles, setSelectedPdfFiles] = useState<string[]>([])
  const [useCustomPrompt, setUseCustomPrompt] = useState(false)
  const [enableTimeLimit, setEnableTimeLimit] = useState(false)

  const [timeStats, setTimeStats] = useState({
    elapsed: 0, avgSpeed: 0, remaining: 0, current: 0, total: 0
  })

  const wsRef = useRef<WebSocket | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (loading) {
      timer = setInterval(() => {
        setTimeStats(prev => ({ ...prev, elapsed: (Date.now() - startTimeRef.current) / 1000 }))
      }, 1000)
    }
    return () => { if (timer) clearInterval(timer) }
  }, [loading])

  useEffect(() => {
    loadConfig()
    loadPdfFiles()
    return () => { if (wsRef.current) wsRef.current.close() }
  }, [])

  const loadConfig = async () => {
    try {
      const data = await getConfig()
      setConfig(data)
      form.setFieldsValue({
        gcp_project: 'cdcda-lab-377808',
        model_id: 'gemini-2.0-flash-001',
        provider: 'gemini',
        location: 'global',
        system_prompt: data.system_prompt,
        max_runtime_minutes: 45
      })
    } catch {
      message.error('載入配置失敗')
    }
  }

  const loadPdfFiles = async () => {
    try {
      const files = await listPdfFiles()
      setPdfFiles(files)
      if (files.length > 0) {
        const def = files.slice(0, Math.min(5, files.length)).map((f: any) => f.name)
        setSelectedPdfFiles(def)
        message.success(`載入 ${files.length} 個 PDF，已預選前 ${def.length} 個`)
      } else {
        message.warning('未找到 PDF 檔案')
      }
    } catch {
      message.error('載入 PDF 檔案列表失敗')
    }
  }

  const handleCheckboxChange = (fileName: string, checked: boolean) => {
    setSelectedPdfFiles(prev =>
      checked ? [...prev, fileName] : prev.filter(f => f !== fileName)
    )
  }

  const handleSelectAll = () => {
    setSelectedPdfFiles(pdfFiles.map(f => f.name))
  }

  const handleDeselectAll = () => {
    setSelectedPdfFiles([])
  }

  const handleSelectFirst = (count: number) => {
    setSelectedPdfFiles(pdfFiles.slice(0, Math.min(count, pdfFiles.length)).map(f => f.name))
  }

  const handleProviderChange = (value: string) => {
    form.setFieldValue('location', value === 'gemini' ? 'global' : 'us-central1')
  }

  const handleModelIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const modelId = e.target.value.toLowerCase()
    if (modelId.includes('gemini') || modelId.includes('palm') || modelId.includes('bison')) {
      form.setFieldsValue({ provider: 'gemini', location: 'global' })
    } else if (modelId.includes('claude') || modelId.includes('anthropic') || modelId.includes('sonnet')) {
      form.setFieldsValue({ provider: 'claude', location: 'us-central1' })
    }
  }

  const handleSubmit = async (values: any) => {
    if (selectedPdfFiles.length === 0) {
      message.warning('請至少選擇一個 PDF 檔案')
      return
    }
    try {
      setLoading(true)
      setProgress(0)
      setCurrentFile('')
      setResult(null)
      startTimeRef.current = Date.now()
      setTimeStats({ elapsed: 0, avgSpeed: 0, remaining: 0, current: 0, total: 0 })

      const extractRequest: ExtractRequest = {
        gcp_project: values.gcp_project,
        model_id: values.model_id,
        provider: values.provider,
        location: values.location,
        temperature: 0.0,
        system_prompt: useCustomPrompt ? values.system_prompt : undefined,
        pdf_files: selectedPdfFiles,
        max_runtime_minutes: enableTimeLimit ? values.max_runtime_minutes : undefined
      }

      message.info(`準備處理 ${selectedPdfFiles.length} 個 PDF 檔案...`)

      wsRef.current = createWebSocket((data) => {
        if (data.type === 'progress') {
          setProgress(Math.round((data.current / data.total) * 100))
          setCurrentFile(data.file)
          const elapsed = (Date.now() - startTimeRef.current) / 1000
          const avgSpeed = elapsed / data.current
          setTimeStats({ elapsed, avgSpeed, remaining: avgSpeed * (data.total - data.current), current: data.current, total: data.total })
        } else if (data.type === 'complete') {
          setProgress(100)
          setResult(data)
          message.success(`萃取完成！成功: ${data.success}, 失敗: ${data.errors}`)
          setLoading(false)
        } else if (data.type === 'error') {
          if (data.message) {
            // 全局錯誤（背景任務失敗）
            message.error(`萃取失敗: ${data.message}`)
            setLoading(false)
          } else {
            message.error(`處理 ${data.file} 時發生錯誤`)
          }
        }
      })

      await extractPdfs(extractRequest)
      // API 立即返回 {"status":"started"}，實際完成由 WebSocket complete 事件處理
    } catch (error: any) {
      message.error(error.message || '萃取失敗')
      setLoading(false)
    }
  }

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`

  // 快速選擇是否 active
  const isActive = (count: number) => selectedPdfFiles.length === count
  const isAllActive = selectedPdfFiles.length === pdfFiles.length && pdfFiles.length > 0

  return (
    <div>
      <Card title={<Space><RocketOutlined /><span>PDF 檔案萃取</span></Space>}>

        {/* 系統資訊 */}
        {config && (
          <Row gutter={16} style={{ marginBottom: 20 }}>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: 'rgba(0,135,62,0.03)', border: '1px solid rgba(0,135,62,0.12)' }}>
                <Statistic title="PDF 檔案數" value={config.pdf_count} suffix="個" valueStyle={{ fontSize: 20, color: '#00873e' }} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: 'rgba(0,135,62,0.03)', border: '1px solid rgba(0,135,62,0.12)' }}>
                <Statistic title="已萃取模型" value={config.extract_count} suffix="個" valueStyle={{ fontSize: 20, color: '#00873e' }} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: 'rgba(0,135,62,0.03)', border: '1px solid rgba(0,135,62,0.12)' }}>
                <Statistic
                  title="基準資料"
                  value={config.ground_truth_exists ? '已就緒' : '未找到'}
                  valueStyle={{ fontSize: 20, color: config.ground_truth_exists ? '#00873e' : '#cf1322' }}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Form form={form} layout="vertical" onFinish={handleSubmit}>

          {/* ── 模型配置：四欄緊湊排列 ── */}
          <Divider orientation="left" style={{ fontSize: 13, color: '#6b7280' }}>模型配置</Divider>
          <Row gutter={12}>
            <Col span={7}>
              <Form.Item label="GCP Project ID" name="gcp_project" rules={[{ required: true }]}>
                <Input placeholder="cdcda-lab-377808" size="middle" />
              </Form.Item>
            </Col>
            <Col span={9}>
              <Form.Item label="Model ID" name="model_id" rules={[{ required: true }]}>
                <Input placeholder="gemini-2.0-flash-001 或 claude-sonnet-4-5@20250929" size="middle" onChange={handleModelIdChange} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="Provider" name="provider" rules={[{ required: true }]}>
                <Select onChange={handleProviderChange} size="middle">
                  <Select.Option value="gemini">Gemini</Select.Option>
                  <Select.Option value="claude">Claude</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="Location" name="location" rules={[{ required: true }]}>
                <Input placeholder="global" size="middle" />
              </Form.Item>
            </Col>
          </Row>

          {/* ── Prompt 設定 ── */}
          <Divider orientation="left" style={{ fontSize: 13, color: '#6b7280' }}>Prompt 設定</Divider>
          <Collapse ghost size="small" style={{ marginBottom: 8 }} items={[{
            key: '1',
            label: (
              <Space>
                <FileTextOutlined />
                <span>自訂 System Prompt（點擊展開）</span>
                {useCustomPrompt && <Tag color="orange">使用自訂</Tag>}
              </Space>
            ),
            children: (
              <>
                <Checkbox checked={useCustomPrompt} onChange={e => setUseCustomPrompt(e.target.checked)} style={{ marginBottom: 10 }}>
                  使用自訂 Prompt
                </Checkbox>
                {useCustomPrompt
                  ? <Form.Item name="system_prompt"><TextArea rows={8} placeholder="輸入自訂的 system prompt..." /></Form.Item>
                  : <Alert message="使用預設 Prompt" type="success" showIcon />
                }
              </>
            )
          }]} />

          {/* ── 選擇 PDF 檔案 ── */}
          <Divider orientation="left" style={{ fontSize: 13, color: '#6b7280' }}>選擇 PDF 檔案</Divider>

          {pdfFiles.length > 0 ? (
            <>
              {/* 快速選擇按鈕列 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>快速選擇：</Text>
                {QUICK_SELECT_OPTIONS.map(({ label, count }) => (
                  <Button
                    key={count}
                    size="small"
                    type={isActive(count) ? 'primary' : 'default'}
                    onClick={() => handleSelectFirst(count)}
                    style={isActive(count) ? { background: '#00873e', borderColor: '#00873e' } : {}}
                  >
                    {label} ({count})
                  </Button>
                ))}
                <Button
                  size="small"
                  type={isAllActive ? 'primary' : 'default'}
                  onClick={handleSelectAll}
                  style={isAllActive ? { background: '#00873e', borderColor: '#00873e' } : {}}
                >
                  全選 ({pdfFiles.length})
                </Button>
                <Button size="small" danger onClick={handleDeselectAll}>清除</Button>
                <Text style={{ marginLeft: 8, color: '#00873e', fontWeight: 600, fontSize: 13 }}>
                  已選 {selectedPdfFiles.length} / {pdfFiles.length} 個
                </Text>
              </div>

              {/* 展開完整列表 */}
              <Collapse ghost size="small" style={{ marginBottom: 12 }} items={[{
                key: '1',
                label: <Space><FileTextOutlined /><span>手動調整選擇</span><Tag color="green">{selectedPdfFiles.length} 個已選</Tag></Space>,
                children: (
                  <div style={{ maxHeight: 320, overflow: 'auto', padding: '4px 0' }}>
                    <Row gutter={[6, 6]}>
                      {pdfFiles.map((file, index) => (
                        <Col span={12} key={file.name}>
                          <div
                            onClick={() => handleCheckboxChange(file.name, !selectedPdfFiles.includes(file.name))}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                              background: selectedPdfFiles.includes(file.name) ? 'rgba(0,135,62,0.08)' : 'transparent',
                              border: `1px solid ${selectedPdfFiles.includes(file.name) ? '#00873e' : '#e8e8e8'}`,
                              transition: 'all 0.15s'
                            }}
                          >
                            <Checkbox
                              checked={selectedPdfFiles.includes(file.name)}
                              onChange={e => { e.stopPropagation(); handleCheckboxChange(file.name, e.target.checked) }}
                            />
                            <div style={{ overflow: 'hidden' }}>
                              <Text style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {index + 1}. {file.name}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 10 }}>{(file.size / 1024).toFixed(1)} KB</Text>
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </div>
                )
              }]} />
            </>
          ) : (
            <Alert message="未找到 PDF 檔案" description="請確認 samplepdflist/ 目錄中有 PDF 檔案" type="warning" showIcon style={{ marginBottom: 12 }} />
          )}

          {/* ── 時間限制 ── */}
          <Divider orientation="left" style={{ fontSize: 13, color: '#6b7280' }}>執行設定</Divider>
          <Checkbox checked={enableTimeLimit} onChange={e => setEnableTimeLimit(e.target.checked)} style={{ marginBottom: 10 }}>
            啟用時間限制（適用於 Cloud Run 等環境）
          </Checkbox>
          {enableTimeLimit && (
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={14}>
                <Form.Item label="最大執行時間（分鐘）" name="max_runtime_minutes">
                  <Slider min={5} max={55} step={5} marks={{ 5: '5', 25: '25', 45: '45', 55: '55' }} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Alert message="到時自動停止，已處理資料會保存" type="warning" showIcon style={{ marginTop: 28 }} />
              </Col>
            </Row>
          )}

          {/* ── 開始萃取 ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(0,135,62,0.1)' }}>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={loading}
                icon={<RocketOutlined />}
                disabled={loading || selectedPdfFiles.length === 0}
                style={{
                  background: loading ? undefined : 'linear-gradient(135deg, #00873e 0%, #00a651 100%)',
                  border: 'none',
                  paddingInline: 32,
                  fontWeight: 600,
                }}
              >
                {loading ? '萃取執行中...' : '開始萃取'}
              </Button>
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {selectedPdfFiles.length > 0
                ? `將處理 ${selectedPdfFiles.length} 個檔案 ｜ 模型：${form.getFieldValue('model_id') || 'gemini-2.0-flash-001'}`
                : '請至少選擇一個 PDF 檔案'}
            </Text>
          </div>

        </Form>

        {/* ── 進度區塊 ── */}
        {loading && (
          <>
            <Divider style={{ margin: '24px 0', borderColor: '#00873e' }}>
              <Text strong style={{ color: '#00873e' }}>萃取進行中</Text>
            </Divider>
            <Card style={{ border: '1px solid rgba(0,135,62,0.2)' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Progress
                  percent={progress}
                  status="active"
                  strokeColor={{ '0%': '#00873e', '100%': '#ffd500' }}
                  strokeWidth={14}
                  format={p => <Text strong>{p}%</Text>}
                />
                {currentFile && (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    <FileTextOutlined /> [{timeStats.current}/{timeStats.total}] {currentFile}
                  </Text>
                )}
                {timeStats.current > 0 && (
                  <Row gutter={12}>
                    <Col span={8}>
                      <Statistic title="已用時間" value={formatTime(timeStats.elapsed)}
                        prefix={<ClockCircleOutlined style={{ color: '#1890ff' }} />}
                        valueStyle={{ fontSize: 18, color: '#1890ff' }} />
                    </Col>
                    <Col span={8}>
                      <Statistic title="平均速度" value={timeStats.avgSpeed.toFixed(1)} suffix="秒/個"
                        prefix={<ThunderboltOutlined style={{ color: '#52c41a' }} />}
                        valueStyle={{ fontSize: 18, color: '#52c41a' }} />
                    </Col>
                    <Col span={8}>
                      <Statistic title="預估剩餘" value={formatTime(timeStats.remaining)}
                        prefix={<HourglassOutlined style={{ color: '#fa8c16' }} />}
                        valueStyle={{ fontSize: 18, color: '#fa8c16' }} />
                    </Col>
                  </Row>
                )}
              </Space>
            </Card>
          </>
        )}

        {/* ── 完成結果 ── */}
        {result && !loading && (
          <>
            <Divider style={{ margin: '24px 0', borderColor: '#52c41a' }}>
              <Text strong style={{ color: '#52c41a' }}>萃取完成</Text>
            </Divider>
            <Card style={{ border: '1px solid rgba(82,196,26,0.3)' }}>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}>
                  <Statistic title="總計檔案" value={result.total} suffix="個"
                    prefix={<FileTextOutlined />} valueStyle={{ color: '#1890ff' }} />
                </Col>
                <Col span={8}>
                  <Statistic title="成功處理" value={result.success} suffix="個"
                    prefix={<CheckCircleOutlined />} valueStyle={{ color: '#3f8600' }} />
                </Col>
                <Col span={8}>
                  <Statistic title="處理失敗" value={result.errors} suffix="個"
                    prefix={<CloseCircleOutlined />}
                    valueStyle={{ color: result.errors > 0 ? '#cf1322' : '#999' }} />
                </Col>
              </Row>
              <div style={{ background: 'rgba(0,0,0,0.02)', padding: '10px 12px', borderRadius: 6 }}>
                <Text copyable style={{ display: 'block', fontSize: 13 }}><FileTextOutlined /> CSV: {result.csv_file}</Text>
                <Text copyable style={{ display: 'block', fontSize: 13, marginTop: 4 }}><FileTextOutlined /> JSONL: {result.jsonl_file}</Text>
              </div>
            </Card>
          </>
        )}

      </Card>
    </div>
  )
}

export default ExtractPage
