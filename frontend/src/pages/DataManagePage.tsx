import { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Popconfirm, message, Tag,
  Typography, Tabs, Row, Col, Statistic, Drawer, Alert,
  Badge,
} from 'antd'
import {
  DeleteOutlined, ReloadOutlined, EyeOutlined,
  DatabaseOutlined, ClearOutlined, WarningOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  listBQRuns, getBQStatus, deleteBQRuns, clearGroundTruth,
  getRunExtractions, type BQRun, type BQStatus,
} from '../services/api'
import dayjs from 'dayjs'

const { Text } = Typography

// ── 輔助元件 ──────────────────────────────────────────────────────────────────
const ProviderTag = ({ provider }: { provider: string }) => {
  const p = (provider || '').toLowerCase()
  if (p === 'gemini') return <Tag color="blue">Gemini</Tag>
  if (p === 'claude') return <Tag color="purple">Claude</Tag>
  return <Tag>{provider || '?'}</Tag>
}

// ============================================================================
// 執行紀錄管理 Tab
// ============================================================================
const RunsTab = ({ onRunsChange }: { onRunsChange: () => void }) => {
  const [runs, setRuns] = useState<BQRun[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [deletingIds, setDeletingIds] = useState<string[]>([])

  // 詳情 Drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerRun, setDrawerRun] = useState<BQRun | null>(null)
  const [extractions, setExtractions] = useState<any[]>([])
  const [extractLoading, setExtractLoading] = useState(false)

  useEffect(() => { loadRuns() }, [])

  const loadRuns = async () => {
    try {
      setLoading(true)
      setRuns(await listBQRuns())
    } catch {
      message.error('載入執行紀錄失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (ids: string[]) => {
    try {
      setDeletingIds(ids)
      await deleteBQRuns(ids)
      message.success(`已刪除 ${ids.length} 筆執行紀錄及其所有萃取結果`)
      setSelectedKeys([])
      loadRuns()
      onRunsChange()
    } catch (err: any) {
      message.error(err.message || '刪除失敗')
    } finally {
      setDeletingIds([])
    }
  }

  const openDrawer = async (run: BQRun) => {
    setDrawerRun(run)
    setDrawerOpen(true)
    setExtractions([])
    try {
      setExtractLoading(true)
      setExtractions(await getRunExtractions(run.run_id))
    } catch {
      message.error('載入萃取明細失敗')
    } finally {
      setExtractLoading(false)
    }
  }

  const columns: ColumnsType<BQRun> = [
    {
      title: 'Model',
      key: 'model',
      width: 240,
      render: (_, r) => (
        <Space>
          <ProviderTag provider={r.provider} />
          <Text strong style={{ fontSize: 13 }}>{r.model_id}</Text>
        </Space>
      ),
    },
    {
      title: '執行時間',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 155,
      defaultSortOrder: 'descend',
      sorter: (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '成功 / 總數',
      key: 'counts',
      width: 110,
      render: (_, r) => (
        <Space size={4}>
          <Text style={{ color: '#00873e', fontWeight: 600 }}>{r.success_count}</Text>
          <Text type="secondary">/ {r.total_files}</Text>
          {r.error_count > 0 && <Tag color="red">{r.error_count} 錯誤</Tag>}
        </Space>
      ),
    },
    {
      title: 'Prompt Hash',
      dataIndex: 'prompt_hash',
      key: 'prompt_hash',
      width: 115,
      render: (h: string) => <Text code style={{ fontSize: 11 }}>{h}</Text>,
    },
    {
      title: 'Run ID',
      dataIndex: 'run_id',
      key: 'run_id',
      ellipsis: true,
      render: (id: string) => (
        <Text type="secondary" style={{ fontSize: 11 }}>{id}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDrawer(r)}
          >
            明細
          </Button>
          <Popconfirm
            title="確定刪除這筆執行紀錄？"
            description="將同時刪除此 run 的所有萃取結果，無法復原。"
            okText="刪除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete([r.run_id])}
          >
            <Button
              type="link"
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={deletingIds.includes(r.run_id)}
            >
              刪除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 萃取明細欄位
  const extractionCols: ColumnsType<any> = [
    { title: '檔案', dataIndex: 'file_name', key: 'file_name', width: 200, ellipsis: true },
    { title: 'NAME', dataIndex: 'NAME', key: 'NAME', width: 130 },
    { title: 'SEX', dataIndex: 'SEX', key: 'SEX', width: 60 },
    { title: 'DATE_OF_BIRTH', dataIndex: 'DATE_OF_BIRTH', key: 'dob', width: 120 },
    { title: 'PLACE_OF_BIRTH', dataIndex: 'PLACE_OF_BIRTH', key: 'pob', ellipsis: true },
  ]

  return (
    <>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 工具列 */}
        <Row justify="space-between" align="middle">
          <Col>
            {selectedKeys.length > 0 && (
              <Popconfirm
                title={`確定刪除選取的 ${selectedKeys.length} 筆執行紀錄？`}
                description="將同時刪除所有選取 run 的萃取結果，無法復原。"
                okText="全部刪除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => handleDelete(selectedKeys)}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={deletingIds.length > 0}
                >
                  刪除選取 ({selectedKeys.length})
                </Button>
              </Popconfirm>
            )}
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={loadRuns} loading={loading}>
              重新整理
            </Button>
          </Col>
        </Row>

        <Table
          columns={columns}
          dataSource={runs}
          rowKey="run_id"
          loading={loading}
          size="small"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys as string[]),
          }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (n) => `共 ${n} 筆`,
          }}
        />
      </Space>

      {/* 萃取明細 Drawer */}
      <Drawer
        title={
          drawerRun && (
            <Space>
              <ProviderTag provider={drawerRun.provider} />
              <span>{drawerRun.model_id}</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {dayjs(drawerRun.started_at).format('YYYY-MM-DD HH:mm')}
              </Text>
            </Space>
          )
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={780}
        extra={
          drawerRun && (
            <Popconfirm
              title="確定刪除此執行紀錄？"
              okText="刪除" okButtonProps={{ danger: true }} cancelText="取消"
              onConfirm={() => { handleDelete([drawerRun.run_id]); setDrawerOpen(false) }}
            >
              <Button danger size="small" icon={<DeleteOutlined />}>刪除此 Run</Button>
            </Popconfirm>
          )
        }
      >
        {drawerRun && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="成功筆數" value={drawerRun.success_count} valueStyle={{ color: '#00873e' }} />
              </Col>
              <Col span={8}>
                <Statistic title="錯誤筆數" value={drawerRun.error_count} valueStyle={{ color: drawerRun.error_count > 0 ? '#cf1322' : undefined }} />
              </Col>
              <Col span={8}>
                <Statistic title="總檔案數" value={drawerRun.total_files} />
              </Col>
            </Row>
            <Card size="small" title="Prompt 預覽">
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {drawerRun.prompt_preview}...
              </Text>
            </Card>
            <Text type="secondary" style={{ fontSize: 11 }}>Run ID: {drawerRun.run_id}</Text>

            <Table
              title={() => <Text strong>萃取明細（{extractions.length} 筆）</Text>}
              columns={extractionCols}
              dataSource={extractions}
              rowKey="file_name"
              loading={extractLoading}
              size="small"
              scroll={{ x: 700 }}
              pagination={{ pageSize: 20, showTotal: (n) => `共 ${n} 筆` }}
            />
          </Space>
        )}
      </Drawer>
    </>
  )
}

// ============================================================================
// Ground Truth 管理 Tab
// ============================================================================
const GroundTruthTab = ({ onChange }: { onChange: () => void }) => {
  const [clearing, setClearing] = useState(false)

  const handleClear = async () => {
    try {
      setClearing(true)
      await clearGroundTruth()
      message.success('Ground Truth 已清空')
      onChange()
    } catch (err: any) {
      message.error(err.message || '清空失敗')
    } finally {
      setClearing(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert
        message="Ground Truth 是準確度分析的基準資料"
        description="若要更新 Ground Truth，請至「檔案管理」頁面重新上傳 CSV。此處僅提供清空操作。"
        type="info"
        showIcon
      />
      <Card size="small">
        <Row align="middle" justify="space-between">
          <Col>
            <Space>
              <WarningOutlined style={{ color: '#fa8c16', fontSize: 18 }} />
              <div>
                <Text strong>清空 Ground Truth 表格</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  刪除 BigQuery 中 ground_truth 表的所有資料，準確度分析將無法執行。
                </Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Popconfirm
              title="確定清空 Ground Truth？"
              description="此操作將刪除所有基準資料，無法復原。"
              okText="確定清空"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={handleClear}
            >
              <Button danger icon={<ClearOutlined />} loading={clearing}>
                清空 Ground Truth
              </Button>
            </Popconfirm>
          </Col>
        </Row>
      </Card>
    </Space>
  )
}

// ============================================================================
// 主頁面
// ============================================================================
const DataManagePage = () => {
  const [status, setStatus] = useState<BQStatus | null>(null)

  useEffect(() => { loadStatus() }, [])

  const loadStatus = async () => {
    try {
      setStatus(await getBQStatus())
    } catch { /* silent */ }
  }

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="large">

        {/* BQ 狀態列 */}
        {status && (
          <Card size="small">
            <Row gutter={24} align="middle">
              <Col>
                <DatabaseOutlined style={{ fontSize: 18, color: '#00873e', marginRight: 6 }} />
                <Text strong>BigQuery</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {status.project} / {status.dataset}
                </Text>
              </Col>
              {Object.entries(status.tables).map(([name, info]) => (
                <Col key={name}>
                  <Space size={4}>
                    <Badge
                      status={info.exists ? 'success' : 'error'}
                      text={
                        <Text style={{ fontSize: 12 }}>
                          <Text type="secondary">{name}: </Text>
                          <Text strong style={{ color: '#00873e' }}>{info.rows.toLocaleString()}</Text>
                          <Text type="secondary"> 筆</Text>
                        </Text>
                      }
                    />
                  </Space>
                </Col>
              ))}
              <Col style={{ marginLeft: 'auto' }}>
                <Button size="small" icon={<ReloadOutlined />} onClick={loadStatus}>
                  重新整理
                </Button>
              </Col>
            </Row>
          </Card>
        )}

        {/* Tabs */}
        <Card>
          <Tabs
            defaultActiveKey="runs"
            items={[
              {
                key: 'runs',
                label: (
                  <Space>
                    <DatabaseOutlined />
                    執行紀錄管理
                    {status && (
                      <Tag style={{ marginLeft: 4 }}>
                        {status.tables['extraction_runs']?.rows ?? 0}
                      </Tag>
                    )}
                  </Space>
                ),
                children: <RunsTab onRunsChange={loadStatus} />,
              },
              {
                key: 'ground_truth',
                label: (
                  <Space>
                    <ClearOutlined />
                    Ground Truth
                    {status && (
                      <Tag style={{ marginLeft: 4 }}>
                        {status.tables['ground_truth']?.rows ?? 0}
                      </Tag>
                    )}
                  </Space>
                ),
                children: <GroundTruthTab onChange={loadStatus} />,
              },
            ]}
          />
        </Card>

      </Space>
    </div>
  )
}

export default DataManagePage
