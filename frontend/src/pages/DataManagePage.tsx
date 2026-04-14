import { useState, useEffect } from 'react'
import {
  Card, Table, Button, Space, Popconfirm, message, Tag,
  Typography, Tabs, Row, Col, Statistic, Drawer, Alert,
  Badge, Select, Input, Tooltip, Modal,
} from 'antd'
import {
  DeleteOutlined, ReloadOutlined, EyeOutlined,
  DatabaseOutlined, ClearOutlined, TableOutlined, ExpandAltOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  listBQRuns, getBQStatus, deleteBQRuns, clearGroundTruth, clearExtractions,
  getRunExtractions, getAllExtractions, getGroundTruthRows, type BQRun, type BQStatus,
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
  const [promptModalOpen, setPromptModalOpen] = useState(false)

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
      title: 'Prompt',
      key: 'prompt',
      render: (_, r) => (
        <Tooltip title={r.prompt_preview}>
          <Text
            type="secondary"
            style={{ fontSize: 11, cursor: 'pointer' }}
            onClick={() => { setDrawerRun(r); setPromptModalOpen(true) }}
          >
            {r.prompt_preview?.slice(0, 60)}{r.prompt_preview?.length > 60 ? '…' : ''}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Run ID',
      dataIndex: 'run_id',
      key: 'run_id',
      ellipsis: true,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text type="secondary" style={{ fontSize: 11 }}>{id}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="查看明細">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => openDrawer(r)}
            />
          </Tooltip>
          <Popconfirm
            title="確定刪除這筆執行紀錄？"
            description="將同時刪除此 run 的所有萃取結果，無法復原。"
            okText="刪除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete([r.run_id])}
          >
            <Tooltip title="刪除">
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={deletingIds.includes(r.run_id)}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 萃取明細欄位（對應 BQ extractions schema 全欄位）
  const extractionCols: ColumnsType<any> = [
    { title: 'run_id', dataIndex: 'run_id', key: 'run_id', width: 120, ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text type="secondary" style={{ fontSize: 10 }}>{v}</Text>
        </Tooltip>
      )},
    { title: 'model_id', dataIndex: 'model_id', key: 'model_id', width: 200, ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
        </Tooltip>
      )},
    { title: 'extracted_at', dataIndex: 'extracted_at', key: 'extracted_at', width: 150,
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-' },
    { title: 'doc_id', dataIndex: 'doc_id', key: 'doc_id', width: 160, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v}</Text></Tooltip> },
    { title: 'file_name', dataIndex: 'file_name', key: 'file_name', width: 180, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v}</Text></Tooltip> },
    { title: 'case_link', dataIndex: 'case_link', key: 'case_link', width: 80,
      render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">連結</a> : '-' },
    { title: 'NAME',           dataIndex: 'NAME',          key: 'NAME', width: 130 },
    { title: 'SEX',            dataIndex: 'SEX',           key: 'SEX',  width: 55 },
    { title: 'DATE_OF_BIRTH',  dataIndex: 'DATE_OF_BIRTH', key: 'dob',  width: 120 },
    { title: 'PLACE_OF_BIRTH', dataIndex: 'PLACE_OF_BIRTH',key: 'pob',  width: 160, ellipsis: true },
    { title: 'raw_json', dataIndex: 'raw_json', key: 'raw_json', width: 80,
      render: (v: string) => v
        ? <Tooltip title={<pre style={{ maxWidth: 400, maxHeight: 300, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(JSON.parse(v), null, 2)}</pre>}>
            <Text style={{ fontSize: 10, color: '#00873e', cursor: 'pointer' }}>查看</Text>
          </Tooltip>
        : '-' },
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
          scroll={{ x: 'max-content' }}
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
            <Card
              size="small"
              title="Prompt 預覽"
              extra={
                <Button
                  type="link" size="small" icon={<ExpandAltOutlined />}
                  onClick={() => setPromptModalOpen(true)}
                >
                  查看完整 Prompt
                </Button>
              }
            >
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {drawerRun.prompt_preview}
                {drawerRun.prompt_full && drawerRun.prompt_full.length > drawerRun.prompt_preview?.length
                  ? <Text type="secondary">…</Text> : null}
              </Text>
            </Card>
            <Text type="secondary" style={{ fontSize: 11 }}>Run ID: {drawerRun.run_id}</Text>

            <Table
              title={() => <Text strong>萃取明細（{extractions.length} 筆）</Text>}
              columns={extractionCols}
              dataSource={extractions}
              rowKey={(r, i) => `${r.run_id}-${r.doc_id}-${i}`}
              loading={extractLoading}
              size="small"
              scroll={{ x: 1400 }}
              pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], showTotal: (n) => `共 ${n} 筆` }}
            />
          </Space>
        )}
      </Drawer>

      {/* 完整 Prompt Modal */}
      <Modal
        title={
          drawerRun && (
            <Space>
              <ProviderTag provider={drawerRun.provider} />
              <span>{drawerRun.model_id} — 完整 Prompt</span>
            </Space>
          )
        }
        open={promptModalOpen}
        onCancel={() => setPromptModalOpen(false)}
        footer={<Button onClick={() => setPromptModalOpen(false)}>關閉</Button>}
        width={720}
      >
        {drawerRun && (
          <div style={{
            background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6,
            padding: '12px 16px', maxHeight: '60vh', overflow: 'auto',
          }}>
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
              {drawerRun.prompt_full || drawerRun.prompt_preview}
            </pre>
          </div>
        )}
      </Modal>
    </>
  )
}

// ============================================================================
// Ground Truth 管理 Tab
// ============================================================================
const GroundTruthTab = ({ onChange }: { onChange: () => void }) => {
  const [clearing, setClearing] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadRows() }, [])

  const loadRows = async () => {
    try {
      setLoading(true)
      setRows(await getGroundTruthRows())
    } catch {
      message.error('載入 Ground Truth 失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    try {
      setClearing(true)
      await clearGroundTruth()
      message.success('Ground Truth 已清空')
      setRows([])
      onChange()
    } catch (err: any) {
      message.error(err.message || '清空失敗')
    } finally {
      setClearing(false)
    }
  }

  // 動態產生欄位（依 BQ schema 實際欄位）
  const columns: ColumnsType<any> = rows.length === 0 ? [] : Object.keys(rows[0]).map(key => ({
    title: key,
    dataIndex: key,
    key,
    ellipsis: true,
    width: key === 'file_name' ? 200 : 160,
  }))

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Row justify="space-between" align="middle">
        <Col>
          <Alert
            message="Ground Truth 是準確度分析的基準資料，若要更新請至「檔案管理」重新上傳 CSV。"
            type="info" showIcon
          />
        </Col>
        <Col style={{ marginLeft: 12 }}>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadRows} loading={loading}>重新整理</Button>
            <Popconfirm
              title="確定清空 Ground Truth？"
              description="此操作將刪除所有基準資料，無法復原。"
              okText="確定清空" okButtonProps={{ danger: true }} cancelText="取消"
              onConfirm={handleClear}
            >
              <Button danger icon={<ClearOutlined />} loading={clearing}>清空</Button>
            </Popconfirm>
          </Space>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={rows}
        rowKey={(_, i) => String(i)}
        loading={loading}
        size="small"
        scroll={{ x: 900 }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (n) => `共 ${n} 筆`,
        }}
      />
    </Space>
  )
}

// ============================================================================
// Extractions 瀏覽 Tab
// ============================================================================
const ExtractionsTab = ({ totalRows, onCleared }: { totalRows: number; onCleared: () => void }) => {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [modelFilter, setModelFilter] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')

  useEffect(() => { loadRows() }, [])

  const loadRows = async () => {
    try {
      setLoading(true)
      setRows(await getAllExtractions(2000))
    } catch {
      message.error('載入 Extractions 失敗')
    } finally {
      setLoading(false)
    }
  }

  const handleClearExtractions = async () => {
    try {
      setClearing(true)
      await clearExtractions()
      message.success('Extractions 表已清空')
      setRows([])
      onCleared()
    } catch {
      message.error('清空失敗')
    } finally {
      setClearing(false)
    }
  }

  const modelOptions = [...new Set(rows.map(r => r.model_id).filter(Boolean))].map(m => ({
    label: m, value: m,
  }))

  const filtered = rows.filter(r => {
    if (modelFilter && r.model_id !== modelFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        (r.doc_id || '').toLowerCase().includes(q) ||
        (r.NAME || '').toLowerCase().includes(q) ||
        (r.file_name || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const columns: ColumnsType<any> = [
    { title: 'run_id', dataIndex: 'run_id', key: 'run_id', width: 120, ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}><Text type="secondary" style={{ fontSize: 10 }}>{v}</Text></Tooltip>
      )},
    { title: 'model_id', dataIndex: 'model_id', key: 'model_id', width: 200,
      render: (m: string) => (
        <Tooltip title={m}>
          <Space size={4}>
            <ProviderTag provider={m?.toLowerCase().includes('gemini') ? 'gemini' : m?.toLowerCase().includes('claude') ? 'claude' : ''} />
            <Text style={{ fontSize: 12 }}>{m}</Text>
          </Space>
        </Tooltip>
      )},
    { title: 'extracted_at', dataIndex: 'extracted_at', key: 'extracted_at', width: 150,
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-' },
    { title: 'doc_id', dataIndex: 'doc_id', key: 'doc_id', width: 160, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v}</Text></Tooltip> },
    { title: 'file_name', dataIndex: 'file_name', key: 'file_name', width: 180, ellipsis: true,
      render: (v: string) => <Tooltip title={v}><Text style={{ fontSize: 12 }}>{v}</Text></Tooltip> },
    { title: 'case_link', dataIndex: 'case_link', key: 'case_link', width: 80,
      render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">連結</a> : '-' },
    { title: 'NAME',           dataIndex: 'NAME',          key: 'NAME', width: 130 },
    { title: 'SEX',            dataIndex: 'SEX',           key: 'SEX',  width: 55 },
    { title: 'DATE_OF_BIRTH',  dataIndex: 'DATE_OF_BIRTH', key: 'dob',  width: 120 },
    { title: 'PLACE_OF_BIRTH', dataIndex: 'PLACE_OF_BIRTH',key: 'pob',  width: 160, ellipsis: true },
    { title: 'raw_json', dataIndex: 'raw_json', key: 'raw_json', width: 80,
      render: (v: string) => v
        ? <Tooltip title={<pre style={{ maxWidth: 400, maxHeight: 300, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(JSON.parse(v), null, 2)}</pre>}>
            <Text style={{ fontSize: 10, color: '#00873e', cursor: 'pointer' }}>查看</Text>
          </Tooltip>
        : '-' },
  ]

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Row justify="space-between" align="middle" gutter={12}>
        <Col>
          <Space>
            <Select
              allowClear
              placeholder="篩選 Model"
              style={{ width: 240 }}
              options={modelOptions}
              value={modelFilter}
              onChange={setModelFilter}
            />
            <Input.Search
              placeholder="搜尋檔案名稱 / NAME"
              style={{ width: 220 }}
              allowClear
              onSearch={setSearch}
              onChange={e => !e.target.value && setSearch('')}
            />
          </Space>
        </Col>
        <Col>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              顯示 {filtered.length} / {rows.length} 筆（BQ 共 {totalRows.toLocaleString()} 筆）
            </Text>
            <Button icon={<ReloadOutlined />} onClick={loadRows} loading={loading}>
              重新整理
            </Button>
            <Popconfirm
              title="清空 Extractions 表"
              description="確定要刪除所有萃取結果嗎？此操作無法復原。"
              onConfirm={handleClearExtractions}
              okText="確定清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button icon={<ClearOutlined />} danger loading={clearing}>
                清空 Extractions
              </Button>
            </Popconfirm>
          </Space>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey={(r, i) => `${r.run_id}-${r.doc_id}-${i}`}
        loading={loading}
        size="small"
        scroll={{ x: 1400 }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (n) => `共 ${n} 筆`,
        }}
      />
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
              {
                key: 'extractions',
                label: (
                  <Space>
                    <TableOutlined />
                    Extractions 明細
                    {status && (
                      <Tag style={{ marginLeft: 4 }}>
                        {status.tables['extractions']?.rows ?? 0}
                      </Tag>
                    )}
                  </Space>
                ),
                children: (
                  <ExtractionsTab
                    totalRows={status?.tables['extractions']?.rows ?? 0}
                    onCleared={loadStatus}
                  />
                ),
              },
            ]}
          />
        </Card>

      </Space>
    </div>
  )
}

export default DataManagePage
