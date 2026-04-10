import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Popconfirm,
  message,
  Tag,
  Typography
} from 'antd'
import {
  FolderOpenOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listModels, deleteModelFile, downloadFile, type ModelInfo } from '../services/api'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-tw'

dayjs.locale('zh-tw')

const { Text } = Typography

const FilesPage = () => {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    try {
      setLoading(true)
      const data = await listModels()
      setModels(data)
    } catch (error) {
      message.error('載入檔案列表失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (fileName: string) => {
    try {
      setDeleting(fileName)
      await deleteModelFile(fileName)
      message.success('刪除成功')
      loadModels() // 重新載入列表
    } catch (error: any) {
      message.error(error.message || '刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  const handleDownload = (fileName: string) => {
    window.open(downloadFile(fileName), '_blank')
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  const getProviderTag = (modelId: string) => {
    if (modelId.toLowerCase().includes('gemini')) {
      return <Tag color="blue">Gemini</Tag>
    } else if (modelId.toLowerCase().includes('claude')) {
      return <Tag color="purple">Claude</Tag>
    }
    return <Tag>Unknown</Tag>
  }

  const columns: ColumnsType<ModelInfo> = [
    {
      title: 'Model ID',
      dataIndex: 'model_id',
      key: 'model_id',
      width: 300,
      render: (text: string) => (
        <Space>
          {getProviderTag(text)}
          <Text strong>{text}</Text>
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
      title: '檔案大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 120,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '修改時間',
      dataIndex: 'modified_time',
      key: 'modified_time',
      width: 200,
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm:ss'),
      sorter: (a, b) => new Date(a.modified_time).getTime() - new Date(b.modified_time).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(record.file_name)}
          >
            下載
          </Button>
          <Popconfirm
            title="確定要刪除這個檔案嗎？"
            description="此操作無法復原"
            onConfirm={() => handleDelete(record.file_name)}
            okText="確定"
            cancelText="取消"
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              loading={deleting === record.file_name}
            >
              刪除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card
        title={
          <Space>
            <FolderOpenOutlined />
            <span>檔案管理</span>
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={loadModels}
            loading={loading}
          >
            重新整理
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={models}
          rowKey="file_name"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 個檔案`,
          }}
        />
      </Card>
    </div>
  )
}

export default FilesPage
