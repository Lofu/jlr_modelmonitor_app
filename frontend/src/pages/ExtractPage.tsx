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
  InputNumber,
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
const { Panel } = Collapse
const { Text } = Typography

const ExtractPage = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [result, setResult] = useState<any>(null)
  const [config, setConfig] = useState<ConfigInfo | null>(null)
  const [pdfFiles, setPdfFiles] = useState<any[]>([])
  const [selectedPdfFiles, setSelectedPdfFiles] = useState<string[]>([])  // 勾選的 PDF 檔案
  const [useCustomPrompt, setUseCustomPrompt] = useState(false)
  const [enableTimeLimit, setEnableTimeLimit] = useState(false)

  // 進度統計
  const [timeStats, setTimeStats] = useState({
    elapsed: 0,
    avgSpeed: 0,
    remaining: 0,
    current: 0,
    total: 0
  })

  const wsRef = useRef<WebSocket | null>(null)
  const startTimeRef = useRef<number>(0)

  // 計時器邏輯：當 loading 狀態為 true 時，每秒更新 elapsed time
  useEffect(() => {
    let timer: NodeJS.Timeout
    if (loading) {
      timer = setInterval(() => {
        setTimeStats(prev => ({
          ...prev,
          elapsed: (Date.now() - startTimeRef.current) / 1000
        }))
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [loading])

  useEffect(() => {
    // 載入系統配置和 PDF 檔案列表
    loadConfig()
    loadPdfFiles()

    return () => {
      // 清理 WebSocket 連接
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const loadConfig = async () => {
    try {
      const data = await getConfig()
      setConfig(data)

      // 設定預設值
      form.setFieldsValue({
        gcp_project: 'cdcda-lab-377808',
        model_id: 'gemini-2.0-flash-001',
        provider: 'gemini',
        location: 'global',
        temperature: 0.0,
        system_prompt: data.system_prompt,
        max_runtime_minutes: 45
      })
    } catch (error) {
      message.error('載入配置失敗')
    }
  }

  const loadPdfFiles = async () => {
    try {
      const files = await listPdfFiles()
      setPdfFiles(files)

      // 預設選擇前 5 個檔案（測試模式）
      if (files.length > 0) {
        const defaultSelection = files.slice(0, Math.min(5, files.length)).map(f => f.name)
        setSelectedPdfFiles(defaultSelection)
        message.success(`載入 ${files.length} 個 PDF 檔案，已預選前 ${defaultSelection.length} 個`)
      } else {
        message.warning('未找到 PDF 檔案')
      }
    } catch (error) {
      message.error('載入 PDF 檔案列表失敗')
    }
  }

  // PDF 檔案 checkbox 處理
  const handleCheckboxChange = (fileName: string, checked: boolean) => {
    if (checked) {
      setSelectedPdfFiles([...selectedPdfFiles, fileName])
    } else {
      setSelectedPdfFiles(selectedPdfFiles.filter(f => f !== fileName))
    }
  }

  const handleSelectAll = () => {
    setSelectedPdfFiles(pdfFiles.map(f => f.name))
    message.success(`已選擇全部 ${pdfFiles.length} 個檔案`)
  }

  const handleDeselectAll = () => {
    setSelectedPdfFiles([])
    message.info('已取消所有選擇')
  }

  const handleSelectFirst = (count: number) => {
    const selected = pdfFiles.slice(0, Math.min(count, pdfFiles.length)).map(f => f.name)
    setSelectedPdfFiles(selected)
    message.success(`已選擇前 ${selected.length} 個檔案`)
  }

  const handleProviderChange = (value: string) => {
    // 根據 provider 自動設定 location
    const defaultLocation = value === 'gemini' ? 'global' : 'us-central1'
    form.setFieldValue('location', defaultLocation)
  }

  const handleModelIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const modelId = e.target.value.toLowerCase()

    // 智能判斷 provider
    if (modelId.includes('gemini') || modelId.includes('palm') || modelId.includes('bison')) {
      form.setFieldsValue({
        provider: 'gemini',
        location: 'global'
      })
    } else if (modelId.includes('claude') || modelId.includes('anthropic') || modelId.includes('sonnet')) {
      form.setFieldsValue({
        provider: 'claude',
        location: 'us-central1'
      })
    }
  }

  const handleSubmit = async (values: any) => {
    // 驗證是否有選擇檔案
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

      setTimeStats({
        elapsed: 0,
        avgSpeed: 0,
        remaining: 0,
        current: 0,
        total: 0
      })

      // 準備萃取請求（使用選中的檔案列表）
      const extractRequest: ExtractRequest = {
        gcp_project: values.gcp_project,
        model_id: values.model_id,
        provider: values.provider,
        location: values.location,
        temperature: values.temperature,
        system_prompt: useCustomPrompt ? values.system_prompt : undefined,
        pdf_files: selectedPdfFiles,  // 使用選中的檔案列表
        max_runtime_minutes: enableTimeLimit ? values.max_runtime_minutes : undefined
      }

      // 顯示確認訊息
      message.info(`準備處理 ${selectedPdfFiles.length} 個 PDF 檔案...`)
      console.log('萃取請求參數:', extractRequest)

      // 建立 WebSocket 連接
      wsRef.current = createWebSocket((data) => {
        if (data.type === 'progress') {
          const percent = Math.round((data.current / data.total) * 100)
          setProgress(percent)
          setCurrentFile(data.file)

          // 更新時間統計
          const elapsed = (Date.now() - startTimeRef.current) / 1000
          const avgSpeed = elapsed / data.current
          const remaining = avgSpeed * (data.total - data.current)

          setTimeStats({
            elapsed,
            avgSpeed,
            remaining,
            current: data.current,
            total: data.total
          })
        } else if (data.type === 'complete') {
          setProgress(100)
          setResult(data)
          message.success(`萃取完成！成功: ${data.success}, 失敗: ${data.errors}`)
          setLoading(false)
        } else if (data.type === 'error') {
          message.error(`處理 ${data.file} 時發生錯誤`)
        }
      })

      // 發送萃取請求
      await extractPdfs(extractRequest)

    } catch (error: any) {
      message.error(error.message || '萃取失敗')
      setLoading(false)
      console.error('萃取錯誤:', error)
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}分${secs}秒`
  }

  return (
    <div>
      <Card
        title={
          <Space>
            <RocketOutlined />
            <span>PDF 檔案萃取</span>
          </Space>
        }
      >
        {config && (
          <Alert
            message="系統資訊"
            description={
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="PDF 檔案數量" value={config.pdf_count} suffix="個" />
                </Col>
                <Col span={8}>
                  <Statistic title="已萃取模型" value={config.extract_count} suffix="個" />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="基準資料"
                    value={config.ground_truth_exists ? '已就緒' : '未找到'}
                    valueStyle={{ color: config.ground_truth_exists ? '#3f8600' : '#cf1322' }}
                  />
                </Col>
              </Row>
            }
            type="info"
            style={{ marginBottom: 24 }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Divider orientation="left">🔧 模型配置</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="GCP Project ID"
                name="gcp_project"
                rules={[{ required: true, message: '請輸入 GCP Project ID' }]}
              >
                <Input placeholder="例如: cdcda-lab-377808" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Model ID"
                name="model_id"
                rules={[{ required: true, message: '請輸入 Model ID' }]}
              >
                <Input
                  placeholder="例如: gemini-2.0-flash-001 或 claude-sonnet-4-5@20250929"
                  onChange={handleModelIdChange}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Provider"
                name="provider"
                rules={[{ required: true }]}
              >
                <Select onChange={handleProviderChange}>
                  <Select.Option value="gemini">Gemini</Select.Option>
                  <Select.Option value="claude">Claude</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Location"
                name="location"
                rules={[{ required: true }]}
              >
                <Input placeholder="例如: global 或 us-central1" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="Temperature"
            name="temperature"
          >
            <InputNumber
              min={0}
              max={1}
              step={0.1}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Divider orientation="left">💬 Prompt 設定</Divider>

          <Collapse ghost>
            <Panel
              header={
                <Space>
                  <FileTextOutlined />
                  <span>自訂 System Prompt（點擊展開編輯）</span>
                  {useCustomPrompt && <Tag color="orange">使用自訂</Tag>}
                </Space>
              }
              key="1"
            >
              <Checkbox
                checked={useCustomPrompt}
                onChange={(e) => setUseCustomPrompt(e.target.checked)}
                style={{ marginBottom: 16 }}
              >
                使用自訂 Prompt
              </Checkbox>

              {useCustomPrompt ? (
                <>
                  <Form.Item
                    name="system_prompt"
                  >
                    <TextArea
                      rows={10}
                      placeholder="輸入自訂的 system prompt..."
                    />
                  </Form.Item>
                  <Alert message="✏️ 使用自訂 Prompt" type="info" showIcon />
                </>
              ) : (
                <Alert message="✅ 使用預設 Prompt" type="success" showIcon />
              )}
            </Panel>
          </Collapse>

          <Divider orientation="left">📊 選擇要萃取的 PDF 檔案</Divider>

          <Alert
            message={
              <Text>
                📁 <Text strong>PDF 來源路徑：</Text>samplepdflist/ 目錄 | 找到 <Text strong style={{ color: '#00873e' }}>{pdfFiles.length}</Text> 個檔案
              </Text>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          {pdfFiles.length > 0 ? (
            <>
              <Card
                title={
                  <Space>
                    <RocketOutlined style={{ color: '#00873e' }} />
                    <Text strong style={{ fontSize: 16 }}>快速選擇處理範圍</Text>
                  </Space>
                }
                style={{
                  marginBottom: 16,
                  border: '2px solid #00873e'
                }}
                headStyle={{ background: 'linear-gradient(135deg, rgba(0, 135, 62, 0.1) 0%, rgba(255, 213, 0, 0.1) 100%)' }}
              >
                <Alert
                  message="💡 提示：選擇處理模式後，也可以在下方手動勾選/取消個別檔案"
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                <Row gutter={[16, 16]}>
                  <Col span={6}>
                    <Card
                      hoverable
                      style={{
                        textAlign: 'center',
                        background: selectedPdfFiles.length === 5 ? 'rgba(0, 135, 62, 0.1)' : 'white',
                        border: selectedPdfFiles.length === 5 ? '3px solid #00873e' : '1px solid #d9d9d9',
                        height: '100%'
                      }}
                      onClick={() => handleSelectFirst(5)}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
                      <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>測試模式</Text>
                      <Button type="primary" size="small" style={{ marginBottom: 8 }}>選前 5 個</Button>
                      <Text type="secondary" style={{ fontSize: 12 }}>快速測試</Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card
                      hoverable
                      style={{
                        textAlign: 'center',
                        background: selectedPdfFiles.length === 20 ? 'rgba(0, 135, 62, 0.1)' : 'white',
                        border: selectedPdfFiles.length === 20 ? '3px solid #00873e' : '1px solid #d9d9d9',
                        height: '100%'
                      }}
                      onClick={() => handleSelectFirst(20)}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                      <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>小批次</Text>
                      <Button type="primary" size="small" style={{ marginBottom: 8 }}>選前 20 個</Button>
                      <Text type="secondary" style={{ fontSize: 12 }}>小規模處理</Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card
                      hoverable
                      style={{
                        textAlign: 'center',
                        background: selectedPdfFiles.length === 50 ? 'rgba(0, 135, 62, 0.1)' : 'white',
                        border: selectedPdfFiles.length === 50 ? '3px solid #00873e' : '1px solid #d9d9d9',
                        height: '100%'
                      }}
                      onClick={() => handleSelectFirst(50)}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                      <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>中批次</Text>
                      <Button type="primary" size="small" style={{ marginBottom: 8 }}>選前 50 個</Button>
                      <Text type="secondary" style={{ fontSize: 12 }}>中規模處理</Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card
                      hoverable
                      style={{
                        textAlign: 'center',
                        background: selectedPdfFiles.length === pdfFiles.length ? 'rgba(0, 135, 62, 0.1)' : 'white',
                        border: selectedPdfFiles.length === pdfFiles.length ? '3px solid #00873e' : '1px solid #d9d9d9',
                        height: '100%'
                      }}
                      onClick={handleSelectAll}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                      <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>全部處理</Text>
                      <Button type="primary" size="small" style={{ marginBottom: 8, background: '#00873e' }}>全選 ({pdfFiles.length})</Button>
                      <Text type="secondary" style={{ fontSize: 12 }}>完整萃取</Text>
                    </Card>
                  </Col>
                </Row>

                <Divider style={{ margin: '16px 0' }} />

                <div style={{ textAlign: 'center' }}>
                  <Space size="large">
                    <Statistic
                      title="已選擇檔案"
                      value={selectedPdfFiles.length}
                      suffix={`/ ${pdfFiles.length}`}
                      valueStyle={{ color: '#00873e', fontSize: 24 }}
                    />
                    <Button
                      danger
                      onClick={handleDeselectAll}
                      icon={<CloseCircleOutlined />}
                    >
                      清除選擇
                    </Button>
                  </Space>
                </div>
              </Card>

              <Collapse
                ghost
                items={[
                  {
                    key: '1',
                    label: (
                      <Space>
                        <FileTextOutlined />
                        <Text strong>📋 查看並手動調整檔案選擇（點擊展開完整列表）</Text>
                        <Tag color="green">{selectedPdfFiles.length} 個已選</Tag>
                      </Space>
                    ),
                    children: (
                      <Card
                        size="small"
                        style={{
                          maxHeight: 400,
                          overflow: 'auto',
                          marginBottom: 16
                        }}
                        bodyStyle={{ padding: 12 }}
                      >
                        <div style={{ marginBottom: 12 }}>
                          <Space wrap>
                            <Button size="small" type="primary" onClick={() => handleSelectFirst(5)}>測試 (5)</Button>
                            <Button size="small" type="primary" onClick={() => handleSelectFirst(20)}>小批次 (20)</Button>
                            <Button size="small" type="primary" onClick={() => handleSelectFirst(50)}>中批次 (50)</Button>
                            <Button size="small" type="primary" onClick={handleSelectAll} style={{ background: '#00873e' }}>全選 ({pdfFiles.length})</Button>
                            <Button size="small" danger onClick={handleDeselectAll}>清除</Button>
                          </Space>
                        </div>

                        <Row gutter={[8, 8]}>
                          {pdfFiles.map((file, index) => (
                            <Col span={12} key={file.name}>
                              <Card
                                size="small"
                                hoverable
                                style={{
                                  background: selectedPdfFiles.includes(file.name)
                                    ? 'rgba(0, 135, 62, 0.1)'
                                    : 'white',
                                  border: selectedPdfFiles.includes(file.name)
                                    ? '2px solid #00873e'
                                    : '1px solid #d9d9d9'
                                }}
                              >
                                <Checkbox
                                  checked={selectedPdfFiles.includes(file.name)}
                                  onChange={(e) => handleCheckboxChange(file.name, e.target.checked)}
                                  style={{ width: '100%' }}
                                >
                                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {index + 1}. {file.name}
                                    </Text>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      大小: {(file.size / 1024).toFixed(1)} KB
                                    </Text>
                                  </Space>
                                </Checkbox>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      </Card>
                    )
                  }
                ]}
                style={{ marginBottom: 16 }}
              />

              <Alert
                message={
                  <Space>
                    <CheckCircleOutlined />
                    <Text strong style={{ fontSize: 16 }}>
                      已選擇 {selectedPdfFiles.length} 個 PDF 檔案
                    </Text>
                  </Space>
                }
                description={
                  <div style={{ marginTop: 8 }}>
                    {selectedPdfFiles.length > 0 ? (
                      <>
                        <Text>📝 將處理以下檔案：</Text>
                        <div style={{ marginTop: 8, maxHeight: 100, overflow: 'auto', background: 'rgba(0,0,0,0.02)', padding: 8, borderRadius: 4 }}>
                          {selectedPdfFiles.slice(0, 5).map(name => (
                            <div key={name}>• {name}</div>
                          ))}
                          {selectedPdfFiles.length > 5 && (
                            <div style={{ color: '#999' }}>... 還有 {selectedPdfFiles.length - 5} 個檔案</div>
                          )}
                        </div>
                      </>
                    ) : (
                      <Text type="warning">請至少勾選一個檔案</Text>
                    )}
                    <br />
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                      點擊下方「開始萃取」按鈕開始執行
                    </Text>
                  </div>
                }
                type={selectedPdfFiles.length > 0 ? "success" : "warning"}
                showIcon
                style={{ marginBottom: 16 }}
              />
            </>
          ) : (
            <Alert
              message="載入中或未找到 PDF 檔案"
              description="請確認 samplepdflist/ 目錄中有 PDF 檔案"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Divider orientation="left">⏰ 執行時間限制（選填）</Divider>

          <Checkbox
            checked={enableTimeLimit}
            onChange={(e) => setEnableTimeLimit(e.target.checked)}
            style={{ marginBottom: 16 }}
          >
            啟用時間限制（適用於 Cloud Run 等環境）
          </Checkbox>

          {enableTimeLimit && (
            <>
              <Form.Item
                label="最大執行時間（分鐘）"
                name="max_runtime_minutes"
              >
                <Slider
                  min={5}
                  max={55}
                  step={5}
                  marks={{
                    5: '5分',
                    25: '25分',
                    45: '45分',
                    55: '55分'
                  }}
                />
              </Form.Item>
              <Alert
                message="⚠️ 執行將在指定時間後自動停止，已處理的資料會被保存"
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
            </>
          )}

          <Divider style={{ margin: '24px 0', borderColor: '#00873e' }} />

          <Card
            style={{
              background: 'linear-gradient(135deg, rgba(0, 135, 62, 0.08) 0%, rgba(255, 213, 0, 0.08) 100%)',
              border: '2px dashed #00873e',
              marginBottom: 16
            }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{ textAlign: 'center' }}>
                <Text strong style={{ fontSize: 18, color: '#00873e' }}>
                  ✅ 配置完成，準備開始萃取
                </Text>
                <br />
                <Text type="secondary">
                  將處理 {selectedPdfFiles.length} 個 PDF 檔案 | 模型: {form.getFieldValue('model_id') || 'gemini-2.0-flash-001'}
                </Text>
              </div>

              <Form.Item style={{ marginBottom: 0, textAlign: 'center' }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  loading={loading}
                  icon={<RocketOutlined />}
                  style={{
                    width: '100%',
                    height: 64,
                    fontSize: 20,
                    fontWeight: 'bold',
                    background: loading
                      ? 'linear-gradient(135deg, #999 0%, #666 100%)'
                      : 'linear-gradient(135deg, #00873e 0%, #00a651 50%, #ffd500 100%)',
                    border: 'none',
                    boxShadow: loading
                      ? 'none'
                      : '0 6px 20px rgba(0, 135, 62, 0.4)',
                  }}
                  disabled={loading || selectedPdfFiles.length === 0}
                >
                  {loading ? '🔄 萃取執行中...' : '🚀 開始萃取'}
                </Button>
              </Form.Item>

              {selectedPdfFiles.length === 0 && (
                <Alert
                  message="無法開始萃取"
                  description="請至少勾選一個 PDF 檔案"
                  type="error"
                  showIcon
                />
              )}
            </Space>
          </Card>
        </Form>

        {loading && (
          <>
            <Divider style={{ margin: '32px 0', borderWidth: 2, borderColor: '#00873e' }}>
              <Text strong style={{ fontSize: 24, color: '#00873e' }}>
                🔄 萃取進行中
              </Text>
            </Divider>

            <Card
              style={{
                background: 'linear-gradient(135deg, rgba(0, 135, 62, 0.03) 0%, rgba(255, 213, 0, 0.03) 100%)',
                border: '2px solid #00873e'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div>
                  <div style={{ marginBottom: 16, textAlign: 'center' }}>
                    <Text strong style={{ fontSize: 20 }}>
                      整體進度: {progress}%
                    </Text>
                  </div>

                  <Progress
                    percent={progress}
                    status="active"
                    strokeColor={{
                      '0%': '#00873e',
                      '50%': '#00a651',
                      '100%': '#ffd500',
                    }}
                    strokeWidth={20}
                    style={{ marginBottom: 16 }}
                  />
                </div>

                {currentFile && (
                  <Alert
                    message={
                      <Space>
                        <Text strong style={{ fontSize: 16 }}>
                          正在處理 [{timeStats.current}/{timeStats.total}]
                        </Text>
                      </Space>
                    }
                    description={
                      <Text style={{ fontSize: 14 }}>
                        <FileTextOutlined /> {currentFile}
                      </Text>
                    }
                    type="info"
                    showIcon
                    icon={<FileTextOutlined style={{ fontSize: 24 }} />}
                  />
                )}

                {timeStats.current > 0 && (
                  <>
                    <Divider orientation="left">⏱️ 時間統計</Divider>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Card
                          hoverable
                          style={{
                            background: 'rgba(24, 144, 255, 0.05)',
                            border: '1px solid #1890ff'
                          }}
                        >
                          <Statistic
                            title={<Text strong>⏱️ 已用時間</Text>}
                            value={formatTime(timeStats.elapsed)}
                            prefix={<ClockCircleOutlined style={{ color: '#1890ff' }} />}
                            valueStyle={{ fontSize: 24, color: '#1890ff' }}
                          />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card
                          hoverable
                          style={{
                            background: 'rgba(82, 196, 26, 0.05)',
                            border: '1px solid #52c41a'
                          }}
                        >
                          <Statistic
                            title={<Text strong>⚡ 平均速度</Text>}
                            value={timeStats.avgSpeed.toFixed(1)}
                            suffix="秒/個"
                            prefix={<ThunderboltOutlined style={{ color: '#52c41a' }} />}
                            valueStyle={{ fontSize: 24, color: '#52c41a' }}
                          />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card
                          hoverable
                          style={{
                            background: 'rgba(250, 140, 22, 0.05)',
                            border: '1px solid #fa8c16'
                          }}
                        >
                          <Statistic
                            title={<Text strong>🕐 預估剩餘</Text>}
                            value={formatTime(timeStats.remaining)}
                            prefix={<HourglassOutlined style={{ color: '#fa8c16' }} />}
                            valueStyle={{ fontSize: 24, color: '#fa8c16' }}
                          />
                        </Card>
                      </Col>
                    </Row>
                  </>
                )}
              </Space>
            </Card>
          </>
        )}

        {result && !loading && (
          <>
            <Divider style={{ margin: '32px 0', borderWidth: 2, borderColor: '#52c41a' }}>
              <Text strong style={{ fontSize: 24, color: '#52c41a' }}>
                ✅ 萃取完成
              </Text>
            </Divider>

            <Card
              style={{
                background: 'linear-gradient(135deg, rgba(82, 196, 26, 0.05) 0%, rgba(255, 213, 0, 0.05) 100%)',
                border: '2px solid #52c41a'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <Alert
                  message={
                    <Text strong style={{ fontSize: 18 }}>
                      🎉 萃取任務執行完畢
                    </Text>
                  }
                  description={
                    <div style={{ marginTop: 12 }}>
                      <Row gutter={16}>
                        <Col span={8}>
                          <Statistic
                            title={<Text strong>總計檔案</Text>}
                            value={result.total}
                            suffix="個"
                            prefix={<FileTextOutlined />}
                            valueStyle={{ fontSize: 32, color: '#1890ff' }}
                          />
                        </Col>
                        <Col span={8}>
                          <Statistic
                            title={<Text strong>成功處理</Text>}
                            value={result.success}
                            suffix="個"
                            valueStyle={{ color: '#3f8600', fontSize: 32 }}
                            prefix={<CheckCircleOutlined />}
                          />
                        </Col>
                        <Col span={8}>
                          <Statistic
                            title={<Text strong>處理失敗</Text>}
                            value={result.errors}
                            suffix="個"
                            valueStyle={{
                              color: result.errors > 0 ? '#cf1322' : '#999',
                              fontSize: 32
                            }}
                            prefix={<CloseCircleOutlined />}
                          />
                        </Col>
                      </Row>

                      <Divider />

                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Text strong style={{ fontSize: 16 }}>📁 輸出檔案：</Text>
                        <div style={{ background: 'rgba(0, 0, 0, 0.02)', padding: 12, borderRadius: 8 }}>
                          <Text copyable><FileTextOutlined /> CSV: {result.csv_file}</Text>
                          <br />
                          <Text copyable><FileTextOutlined /> JSONL: {result.jsonl_file}</Text>
                        </div>
                      </Space>
                    </div>
                  }
                  type="success"
                  showIcon
                  icon={<CheckCircleOutlined style={{ fontSize: 32 }} />}
                />
              </Space>
            </Card>
          </>
        )}
      </Card>
    </div>
  )
}

export default ExtractPage
