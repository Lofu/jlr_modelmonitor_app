import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  message,
  Tag,
  Typography,
  Divider,
  Select,
  Form,
  Input,
  Upload,
  Alert,
  Row,
  Col,
  Statistic,
} from 'antd'
import {
  FolderOpenOutlined,
  ReloadOutlined,
  ImportOutlined,
  UploadOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  listBQRuns,
  getBQStatus,
  listJsonlFiles,
  importJsonlToBQ,
  uploadGroundTruth,
  type BQRun,
  type BQStatus,
} from '../services/api'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-tw'

dayjs.locale('zh-tw')

const { Text } = Typography

const getProviderTag = (provider: string) => {
  const p = (provider || '').toLowerCase()
  if (p === 'gemini') return <Tag color="blue">Gemini</Tag>
  if (p === 'claude') return <Tag color="purple">Claude</Tag>
  return <Tag>{provider || '?'}</Tag>
}

const FilesPage = () => {
  const [runs, setRuns] = useState<BQRun[]>([])
  const [bqStatus, setBqStatus] = useState<BQStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)

  // 匯入 JSONL
  const [jsonlFiles, setJsonlFiles] = useState<any[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importForm] = Form.useForm()

  // 上傳 Ground Truth
  const [gtFile, setGtFile] = useState<File | null>(null)
  const [gtUploading, setGtUploading] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    loadRuns()
    loadStatus()
    loadJsonlFiles()
  }

  const loadRuns = async () => {
    try {
      setLoading(true)
      const data = await listBQRuns()
      setRuns(data)
    } catch {
      message.error('載入 BQ 執行紀錄失敗')
    } finally {
      setLoading(false)
    }
  }

  const loadStatus = async () => {
    try {
      setStatusLoading(true)
      const s = await getBQStatus()
      setBqStatus(s)
    } catch {
      // silent
    } finally {
      setStatusLoading(false)
    }
  }

  const loadJsonlFiles = async () => {
    try {
      const files = await listJsonlFiles()
      setJsonlFiles(files)
    } catch {
      // silent
    }
  }

  const handleImport = async (values: any) => {
    try {
      setImportLoading(true)
      const res = await importJsonlToBQ({
        jsonl_file: values.jsonl_file,
        model_id: values.model_id,
        provider: values.provider,
        location: values.location || 'us-central1',
      })
      message.success(`匯入成功！run_id: ${res.run_id}`)
      importForm.resetFields()
      loadRuns()
      loadStatus()
    } catch (err: any) {
      message.error(err.message || '匯入失敗')
    } finally {
      setImportLoading(false)
    }
  }

  const handleGroundTruthUpload = async () => {
    if (!gtFile) {
      message.warning('請先選擇 CSV 檔案')
      return
    }
    try {
      setGtUploading(true)
      const res = await uploadGroundTruth(gtFile)
      message.success(`Ground Truth 上傳成功！共 ${res.count} 筆`)
      setGtFile(null)
      loadStatus()
    } catch (err: any) {
      message.error(err.message || '上傳失敗')
    } finally {
      setGtUploading(false)
    }
  }

  // ── BQ runs 表格欄位 ──
  const columns: ColumnsType<BQRun> = [
    {
      title: 'Model',
      key: 'model',
      width: 260,
      render: (_, r) => (
        <Space>
          {getProviderTag(r.provider)}
          <Text strong style={{ fontSize: 13 }}>{r.model_id}</Text>
        </Space>
      ),
    },
    {
      title: '執行時間',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 160,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
      defaultSortOrder: 'descend',
      sorter: (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    },
    {
      title: '成功/總數',
      key: 'counts',
      width: 110,
      render: (_, r) => (
        <Text>
          <Text style={{ color: '#00873e', fontWeight: 600 }}>{r.success_count}</Text>
          <Text type="secondary"> / {r.total_files}</Text>
        </Text>
      ),
    },
    {
      title: 'Prompt Hash',
      dataIndex: 'prompt_hash',
      key: 'prompt_hash',
      width: 120,
      render: (h: string) => <Text code style={{ fontSize: 11 }}>{h}</Text>,
    },
    {
      title: 'Run ID',
      dataIndex: 'run_id',
      key: 'run_id',
      ellipsis: true,
      render: (id: string) => <Text type="secondary" style={{ fontSize: 11 }}>{id}</Text>,
    },
  ]

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="large">

        {/* ── BQ 狀態 ── */}
        {bqStatus && (
          <Card size="small">
            <Row gutter={24} align="middle">
              <Col>
                <DatabaseOutlined style={{ fontSize: 20, color: '#00873e', marginRight: 8 }} />
                <Text strong>BigQuery</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {bqStatus.project} / {bqStatus.dataset}
                </Text>
              </Col>
              {Object.entries(bqStatus.tables).map(([name, info]) => (
                <Col key={name}>
                  <Statistic
                    title={name}
                    value={info.rows}
                    suffix="筆"
                    valueStyle={{ fontSize: 16, color: info.exists ? '#00873e' : '#cf1322' }}
                  />
                </Col>
              ))}
            </Row>
          </Card>
        )}

        {/* ── BQ 執行紀錄 ── */}
        <Card
          title={
            <Space>
              <FolderOpenOutlined />
              <span>執行紀錄 (BigQuery)</span>
            </Space>
          }
          extra={
            <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading || statusLoading}>
              重新整理
            </Button>
          }
        >
          <Table
            columns={columns}
            dataSource={runs}
            rowKey="run_id"
            loading={loading}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (n) => `共 ${n} 筆` }}
          />
        </Card>

        <Row gutter={24}>
          {/* ── 匯入 JSONL ── */}
          <Col span={14}>
            <Card
              title={
                <Space>
                  <ImportOutlined />
                  <span>匯入 JSONL 歷史資料</span>
                </Space>
              }
            >
              <Alert
                message="將 data/outputs/ 目錄中的 JSONL 檔案匯入 BigQuery，供後續分析使用。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {jsonlFiles.length === 0 ? (
                <Alert message="data/outputs/ 目錄中找不到 JSONL 檔案" type="warning" showIcon />
              ) : (
                <Form form={importForm} layout="vertical" onFinish={handleImport}>
                  <Form.Item
                    name="jsonl_file"
                    label="選擇 JSONL 檔案"
                    rules={[{ required: true, message: '請選擇檔案' }]}
                  >
                    <Select placeholder="選擇要匯入的檔案">
                      {jsonlFiles.map((f) => (
                        <Select.Option key={f.name} value={f.name}>
                          {f.name}
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                            ({dayjs(f.modified_time).format('MM-DD HH:mm')})
                          </Text>
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Row gutter={12}>
                    <Col span={12}>
                      <Form.Item
                        name="model_id"
                        label="Model ID"
                        rules={[{ required: true, message: '請輸入 Model ID' }]}
                      >
                        <Input placeholder="e.g. gemini-2.5-flash" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        name="provider"
                        label="Provider"
                        rules={[{ required: true, message: '必填' }]}
                      >
                        <Select>
                          <Select.Option value="gemini">gemini</Select.Option>
                          <Select.Option value="claude">claude</Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="location" label="Location" initialValue="us-central1">
                        <Input placeholder="us-central1" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={importLoading}
                    icon={<ImportOutlined />}
                    block
                  >
                    {importLoading ? '匯入中...' : '匯入至 BigQuery'}
                  </Button>
                </Form>
              )}
            </Card>
          </Col>

          {/* ── 上傳 Ground Truth ── */}
          <Col span={10}>
            <Card
              title={
                <Space>
                  <UploadOutlined />
                  <span>上傳 Ground Truth</span>
                </Space>
              }
            >
              <Alert
                message="上傳後將覆寫 BigQuery 中的 ground_truth 表格（全量替換）。"
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Space direction="vertical" style={{ width: '100%' }}>
                <Upload
                  accept=".csv"
                  maxCount={1}
                  beforeUpload={(file) => {
                    setGtFile(file)
                    return false  // 不自動上傳
                  }}
                  onRemove={() => setGtFile(null)}
                  fileList={gtFile ? [{ uid: '-1', name: gtFile.name, status: 'done' }] : []}
                >
                  <Button icon={<UploadOutlined />} style={{ width: '100%' }}>
                    選擇 CSV 檔案
                  </Button>
                </Upload>

                {bqStatus && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    目前 BQ ground_truth 表格：
                    <Text strong style={{ color: '#00873e' }}>
                      {bqStatus.tables['ground_truth']?.rows ?? 0}
                    </Text> 筆
                  </Text>
                )}

                <Button
                  type="primary"
                  onClick={handleGroundTruthUpload}
                  loading={gtUploading}
                  disabled={!gtFile}
                  icon={<UploadOutlined />}
                  block
                  style={{ marginTop: 8 }}
                >
                  {gtUploading ? '上傳中...' : '上傳至 BigQuery'}
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>

      </Space>
    </div>
  )
}

export default FilesPage
