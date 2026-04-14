import { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Popconfirm, message, Tag,
  Typography, Modal, Form, Select, Alert, Row, Col, Upload, Tooltip,
} from 'antd'
import {
  FolderOpenOutlined, DeleteOutlined, DownloadOutlined,
  ReloadOutlined, ImportOutlined, UploadOutlined, DatabaseOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  listExtractFiles, deleteModelFile, downloadFile,
  importCsvToBQ, uploadGroundTruth, getBQStatus,
  type ExtractFileInfo, type BQStatus,
} from '../services/api'
import dayjs from 'dayjs'

const { Text } = Typography

const inferProvider = (modelId: string) => {
  const m = modelId.toLowerCase()
  if (m.includes('gemini')) return 'gemini'
  if (m.includes('claude')) return 'claude'
  return ''
}

const FilesPage = () => {
  const [files, setFiles] = useState<ExtractFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [bqStatus, setBqStatus] = useState<BQStatus | null>(null)

  // 匯入 BQ modal
  const [importTarget, setImportTarget] = useState<ExtractFileInfo | null>(null)
  const [importing, setImporting] = useState(false)
  const [importForm] = Form.useForm()

  // Ground Truth 上傳
  const [gtFile, setGtFile] = useState<File | null>(null)
  const [gtUploading, setGtUploading] = useState(false)

  useEffect(() => {
    loadFiles()
    loadBqStatus()
  }, [])

  const loadFiles = async () => {
    try {
      setLoading(true)
      setFiles(await listExtractFiles())
    } catch {
      message.error('載入萃取結果列表失敗')
    } finally {
      setLoading(false)
    }
  }

  const loadBqStatus = async () => {
    try { setBqStatus(await getBQStatus()) } catch { /* silent */ }
  }

  const handleDelete = async (fileName: string) => {
    try {
      setDeleting(fileName)
      await deleteModelFile(fileName)
      message.success('刪除成功')
      loadFiles()
    } catch (err: any) {
      message.error(err.message || '刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  const openImportModal = (file: ExtractFileInfo) => {
    setImportTarget(file)
    importForm.setFieldsValue({
      provider: inferProvider(file.model_id) || undefined,
      location: 'us-central1',
    })
  }

  const handleImport = async (values: any) => {
    if (!importTarget) return
    try {
      setImporting(true)
      const res = await importCsvToBQ({
        csv_file: importTarget.file_name,
        provider: values.provider,
        location: values.location,
      })
      message.success(`匯入成功！run_id: ${res.run_id}`)
      setImportTarget(null)
      importForm.resetFields()
      loadBqStatus()
    } catch (err: any) {
      message.error(err.message || '匯入失敗')
    } finally {
      setImporting(false)
    }
  }

  const handleGroundTruthUpload = async () => {
    if (!gtFile) return message.warning('請先選擇 CSV 檔案')
    try {
      setGtUploading(true)
      const res = await uploadGroundTruth(gtFile)
      message.success(`Ground Truth 上傳成功！共 ${res.count} 筆`)
      setGtFile(null)
      loadBqStatus()
    } catch (err: any) {
      message.error(err.message || '上傳失敗')
    } finally {
      setGtUploading(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const getProviderTag = (modelId: string) => {
    const p = inferProvider(modelId)
    if (p === 'gemini') return <Tag color="blue">Gemini</Tag>
    if (p === 'claude') return <Tag color="purple">Claude</Tag>
    return <Tag>Unknown</Tag>
  }

  const columns: ColumnsType<ExtractFileInfo> = [
    {
      title: 'Model ID',
      key: 'model',
      width: 300,
      render: (_, r) => (
        <Space>
          {getProviderTag(r.model_id)}
          <Text strong>{r.model_id}</Text>
        </Space>
      ),
    },
    {
      title: '檔案名稱',
      dataIndex: 'file_name',
      key: 'file_name',
      ellipsis: true,
    },
    {
      title: '記錄數',
      dataIndex: 'record_count',
      key: 'record_count',
      width: 90,
      render: (n: number) => <Text style={{ color: '#00873e', fontWeight: 600 }}>{n}</Text>,
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 90,
      render: (s: number) => formatSize(s),
    },
    {
      title: '修改時間',
      dataIndex: 'modified_time',
      key: 'modified_time',
      width: 170,
      defaultSortOrder: 'descend',
      sorter: (a, b) => new Date(a.modified_time).getTime() - new Date(b.modified_time).getTime(),
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="下載">
            <Button
              type="text" size="small" icon={<DownloadOutlined />}
              onClick={() => window.open(downloadFile(r.file_name), '_blank')}
            />
          </Tooltip>
          <Tooltip title="匯入 BQ">
            <Button
              type="text" size="small" icon={<ImportOutlined />}
              style={{ color: '#00873e' }}
              onClick={() => openImportModal(r)}
            />
          </Tooltip>
          <Popconfirm
            title="確定刪除這個檔案嗎？"
            description="此操作無法復原"
            onConfirm={() => handleDelete(r.file_name)}
            okText="確定" cancelText="取消"
          >
            <Tooltip title="刪除">
              <Button
                type="text" danger size="small" icon={<DeleteOutlined />}
                loading={deleting === r.file_name}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="large">

        {/* ── CSV 萃取結果列表 ── */}
        <Card
          title={
            <Space>
              <FolderOpenOutlined />
              <span>萃取結果（data/extracts/）</span>
            </Space>
          }
          extra={
            <Button icon={<ReloadOutlined />} onClick={loadFiles} loading={loading}>
              重新整理
            </Button>
          }
        >
          <Alert
            message={
              <Text>
                CSV 檔案為每次萃取的結果，可下載查看、刪除，或點「匯入 BQ」寫入 BigQuery 供準確度分析使用。
              </Text>
            }
            type="info" showIcon style={{ marginBottom: 16 }}
          />
          <Table
            columns={columns}
            dataSource={files}
            rowKey="file_name"
            loading={loading}
            size="small"
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (n) => `共 ${n} 個檔案` }}
          />
        </Card>

        {/* ── Ground Truth 上傳 ── */}
        <Card
          title={
            <Space>
              <UploadOutlined />
              <span>上傳 Ground Truth</span>
            </Space>
          }
        >
          <Row gutter={24} align="middle">
            <Col flex="auto">
              <Alert
                message="上傳後覆寫 BigQuery ground_truth 表（全量替換），作為準確度分析的基準資料。"
                type="warning" showIcon
              />
              {bqStatus && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  <DatabaseOutlined style={{ marginRight: 4 }} />
                  目前 BQ <Text code>ground_truth</Text> 表：
                  <Text strong style={{ color: '#00873e', marginLeft: 4 }}>
                    {bqStatus.tables['ground_truth']?.rows ?? 0}
                  </Text> 筆
                </Text>
              )}
            </Col>
            <Col>
              <Space direction="vertical" style={{ width: 220 }}>
                <Upload
                  accept=".csv" maxCount={1}
                  beforeUpload={(file) => { setGtFile(file); return false }}
                  onRemove={() => setGtFile(null)}
                  fileList={gtFile ? [{ uid: '-1', name: gtFile.name, status: 'done' }] : []}
                >
                  <Button icon={<UploadOutlined />} style={{ width: 220 }}>
                    選擇 CSV 檔案
                  </Button>
                </Upload>
                <Button
                  type="primary" onClick={handleGroundTruthUpload}
                  loading={gtUploading} disabled={!gtFile}
                  icon={<UploadOutlined />} block
                >
                  上傳至 BigQuery
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

      </Space>

      {/* ── 匯入 BQ Modal ── */}
      <Modal
        title={
          <Space>
            <ImportOutlined style={{ color: '#00873e' }} />
            <span>匯入至 BigQuery</span>
          </Space>
        }
        open={!!importTarget}
        onCancel={() => { setImportTarget(null); importForm.resetFields() }}
        footer={null}
        width={480}
      >
        {importTarget && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">

            {/* 檔案資訊 */}
            <Card size="small" style={{ background: '#f8fdf9', border: '1px solid #b7e4c7' }}>
              <Space direction="vertical" size={2}>
                <Text type="secondary" style={{ fontSize: 11 }}>來源檔案</Text>
                <Text strong>{importTarget.file_name}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {importTarget.record_count} 筆記錄 · Model: {importTarget.model_id}
                </Text>
              </Space>
            </Card>

            {/* 目標表格說明 */}
            <Alert
              message={
                <Space direction="vertical" size={2}>
                  <Text strong><DatabaseOutlined /> 匯入目標（BigQuery）</Text>
                  <Text style={{ fontSize: 12 }}>
                    ① <Text code>extraction_runs</Text> — 新增一筆執行紀錄（model_id、時間、prompt）
                  </Text>
                  <Text style={{ fontSize: 12 }}>
                    ② <Text code>extractions</Text> — 新增 {importTarget.record_count} 筆萃取結果（NAME、SEX、DATE_OF_BIRTH、PLACE_OF_BIRTH）
                  </Text>
                </Space>
              }
              type="info"
            />

            <Form form={importForm} layout="vertical" onFinish={handleImport}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    name="provider" label="Provider"
                    rules={[{ required: true, message: '請選擇 Provider' }]}
                  >
                    <Select placeholder="選擇 Provider">
                      <Select.Option value="gemini">gemini</Select.Option>
                      <Select.Option value="claude">claude</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="location" label="Location" initialValue="us-central1">
                    <Select>
                      <Select.Option value="us-central1">us-central1</Select.Option>
                      <Select.Option value="asia-east1">asia-east1</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <Button
                type="primary" htmlType="submit" loading={importing}
                icon={<ImportOutlined />} block
                style={{ background: '#00873e' }}
              >
                {importing ? '匯入中...' : '確認匯入至 BigQuery'}
              </Button>
            </Form>

          </Space>
        )}
      </Modal>
    </div>
  )
}

export default FilesPage
