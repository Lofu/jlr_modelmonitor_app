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
  Select,
  Modal,
  Collapse,
} from 'antd'
import {
  BarChartOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  Legend, ResponsiveContainer, Cell, LabelList, ReferenceLine,
} from 'recharts'
import { listBQRuns, analyzeAccuracyBQ, getCaseCounts, type BQRun } from '../services/api'
import dayjs from 'dayjs'

const { Text } = Typography

/**
 * 將各種格式的 model_id 轉成易讀的顯示名稱
 * 例：
 *   "Claude_Sonnet_4_6"                    → "Claude Sonnet 4.6"
 *   "claude-sonnet-4-6"                    → "Claude Sonnet 4.6"
 *   "gemini-2.0-flash-001_extract_v1.0_part1" → "Gemini 2.0 Flash 001"
 *   "gemini-2.5-flash (b1511df5)"          → "Gemini 2.5 Flash (b1511df5)"
 */
const formatModelId = (modelId: string): string => {
  if (!modelId) return modelId
  // 保留末尾 prompt hash "(xxxxxxxx)"
  const hashMatch = modelId.match(/^(.+?)\s*\(([a-f0-9]+)\)$/)
  const basePart = hashMatch ? hashMatch[1].trim() : modelId
  const hashSuffix = hashMatch ? ` (${hashMatch[2]})` : ''
  // 移除檔名後綴 _extract_v1.0_part1 等
  let name = basePart.replace(/_extract_v[\d.]+(_part\d+)?$/i, '')
  // _ 和 - 全部換成空格
  name = name.replace(/[_-]/g, ' ')
  // 合併連續數字中間的空格：「4 6」→「4.6」
  name = name.replace(/\b(\d) (\d)\b/g, '$1.$2')
  // 每個單字首字大寫
  name = name.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return name + hashSuffix
}

const getProviderTag = (provider: string) => {
  const p = provider?.toLowerCase() || ''
  if (p === 'gemini') return <Tag color="blue">Gemini</Tag>
  if (p === 'claude') return <Tag color="purple">Claude</Tag>
  return <Tag>{provider || 'Unknown'}</Tag>
}

const AnalyzePage = () => {
  const [runs, setRuns] = useState<BQRun[]>([])
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [caseCounts, setCaseCounts] = useState<Record<string, number>>({})
  const [promptModal, setPromptModal] = useState<{ open: boolean; content: string }>({ open: false, content: '' })
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [selectedField, setSelectedField] = useState<string>('PLACE_OF_BIRTH')

  useEffect(() => {
    loadRuns()
  }, [])

  const loadRuns = async () => {
    try {
      setLoading(true)
      const [data, counts] = await Promise.all([listBQRuns(), getCaseCounts()])
      setRuns(data)
      if (data.length > 0 && selectedRunIds.length === 0) {
        setSelectedRunIds(data.map((r) => r.run_id))
      }
      const countMap: Record<string, number> = {}
      counts.forEach(c => { countMap[`${c.model_id}||${c.prompt_hash}`] = c.record_count })
      setCaseCounts(countMap)
    } catch (error) {
      message.error('載入 BQ 執行紀錄失敗，請確認 BigQuery 連線設定')
    } finally {
      setLoading(false)
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
    { title: '欄位', dataIndex: 'field', key: 'field', fixed: 'left' as const, width: 90 },
    ...(result?.model_names || []).map((modelId: string) => ({
      title: (
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          {formatModelId(result?.model_display_names?.[modelId] || modelId)}
        </span>
      ),
      key: modelId,
      children: [
        {
          title: '完全一致率',
          dataIndex: `${modelId}_exact`,
          key: `${modelId}_exact`,
          width: 110,
          align: 'center' as const,
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
        {
          title: '平均相似度',
          dataIndex: `${modelId}_avg`,
          key: `${modelId}_avg`,
          width: 110,
          align: 'center' as const,
        },
        {
          title: '成功/總數',
          dataIndex: `${modelId}_count`,
          key: `${modelId}_count`,
          width: 100,
          align: 'center' as const,
        },
      ],
    })),
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
  // 固定每個模型的顏色，所有圖表共用
  const modelColorMap: Record<string, string> = {}
  ;(result?.model_names || []).forEach((id: string, i: number) => {
    modelColorMap[id] = colors[i % colors.length]
  })

  // ── Case 分組：同模型 + 同 prompt_hash = 一種 case ──────────────────────
  type CaseGroup = {
    key: string; provider: string; model_id: string
    prompt_hash: string; prompt_preview: string
    runs: BQRun[]; latestAt: string
  }
  const caseGroups: CaseGroup[] = (() => {
    const map: Record<string, CaseGroup> = {}
    runs.forEach(run => {
      const key = `${run.model_id}||${run.prompt_hash}`
      if (!map[key]) map[key] = {
        key, provider: run.provider, model_id: run.model_id,
        prompt_hash: run.prompt_hash, prompt_preview: run.prompt_preview || '',
        runs: [], latestAt: run.started_at,
      }
      const c = map[key]
      c.runs.push(run)
      if (dayjs(run.started_at).isAfter(dayjs(c.latestAt))) c.latestAt = run.started_at
    })
    return Object.values(map).sort((a, b) =>
      dayjs(b.latestAt).unix() - dayjs(a.latestAt).unix()
    )
  })()

  const modelGroups = (() => {
    const map: Record<string, { provider: string; model_id: string; cases: CaseGroup[] }> = {}
    caseGroups.forEach(c => {
      const mk = `${c.provider}||${c.model_id}`
      if (!map[mk]) map[mk] = { provider: c.provider, model_id: c.model_id, cases: [] }
      map[mk].cases.push(c)
    })
    return Object.values(map)
  })()

  const toggleCase = (caseGroup: CaseGroup) => {
    const ids = caseGroup.runs.map(r => r.run_id)
    const allSel = ids.every(id => selectedRunIds.includes(id))
    if (allSel) {
      setSelectedRunIds(prev => prev.filter(id => !ids.includes(id)))
    } else {
      setSelectedRunIds(prev => [...new Set([...prev, ...ids])])
    }
  }

  const selectedCasesCount = caseGroups.filter(c =>
    c.runs.every(r => selectedRunIds.includes(r.run_id))
  ).length

  return (
    <>
    <Space direction="vertical" style={{ width: '100%' }} size="large">

      {/* ── 選擇執行版本 + 計算邏輯說明 ── */}
      <Row gutter={16} align="stretch">
        <Col xs={24} lg={12}>
      <Card
        title={<Space><BarChartOutlined /><span>選擇分析對象</span></Space>}
        style={{ height: '100%' }}
        extra={
          <Space>
            <Text type="secondary" style={{ fontSize: 13 }}>
              已選 <Text strong style={{ color: '#00873e' }}>{selectedCasesCount}</Text> / {caseGroups.length} 種
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
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {modelGroups.map(mg => {
              const allModelIds = mg.cases.flatMap(c => c.runs.map(r => r.run_id))
              const allModelSel = allModelIds.every(id => selectedRunIds.includes(id))
              return (
                <div key={`${mg.provider}||${mg.model_id}`}>
                  {/* 模型標題列 */}
                  <Row align="middle" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #f0f0f0' }}>
                    <Col flex="auto">
                      <Space size={8}>
                        {getProviderTag(mg.provider)}
                        <Text strong style={{ fontSize: 14 }}>{formatModelId(mg.model_id)}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {mg.cases.length} 種 Prompt
                        </Text>
                      </Space>
                    </Col>
                    <Col>
                      <Button size="small" type="link" style={{ padding: '0 4px', fontSize: 12 }}
                        onClick={() => {
                          if (allModelSel) {
                            setSelectedRunIds(prev => prev.filter(id => !allModelIds.includes(id)))
                          } else {
                            setSelectedRunIds(prev => [...new Set([...prev, ...allModelIds])])
                          }
                        }}
                      >
                        {allModelSel ? '取消全選' : '全選此模型'}
                      </Button>
                    </Col>
                  </Row>

                  {/* 每種 case（同模型＋同 prompt）一張 card */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {mg.cases.map(caseGroup => {
                      const selected = caseGroup.runs.every(r => selectedRunIds.includes(r.run_id))
                      const runCount = caseGroup.runs.length
                      return (
                        <div key={caseGroup.key} style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 360 }}>
                          <Card
                            size="small"
                            style={{
                              border: selected ? '2px solid #00873e' : '1px solid #e8e8e8',
                              background: selected ? '#f6ffed' : '#fafafa',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                            styles={{ body: { padding: '8px 12px' } }}
                            onClick={() => toggleCase(caseGroup)}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              {/* 左側：固定兩行內容 */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {/* 第一行：Prompt 版號 + 查看 */}
                                <Space size={4}>
                                  <Text type="secondary" style={{ fontSize: 11 }}>Prompt:</Text>
                                  <Tag
                                    style={{
                                      background: '#262626', color: '#fff',
                                      border: 'none', fontFamily: 'monospace',
                                      fontSize: 12, padding: '1px 7px', margin: 0,
                                    }}
                                  >
                                    {caseGroup.prompt_hash.slice(0, 8)}
                                  </Tag>
                                  <Button
                                    type="link"
                                    size="small"
                                    style={{ padding: 0, fontSize: 11, height: 'auto' }}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const full = caseGroup.runs[0]?.prompt_full || caseGroup.prompt_preview || '（無內容）'
                                      setPromptModal({ open: true, content: full })
                                    }}
                                  >
                                    查看
                                  </Button>
                                </Space>
                                {/* 第二行：筆數 + runs + 日期 */}
                                <div style={{ marginTop: 4 }}>
                                  <Space size={6}>
                                    {(() => {
                                      const cnt = caseCounts[`${caseGroup.model_id}||${caseGroup.prompt_hash}`]
                                      return cnt !== undefined
                                        ? <Text style={{ fontSize: 12 }}><Text strong style={{ color: '#00873e' }}>{cnt}</Text> 筆</Text>
                                        : <Text type="secondary" style={{ fontSize: 12 }}>…</Text>
                                    })()}
                                    {runCount > 1 && (
                                      <Tag color="blue" style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>{runCount} runs</Tag>
                                    )}
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      {dayjs(caseGroup.latestAt).format('MM-DD HH:mm')}
                                    </Text>
                                  </Space>
                                </div>
                              </div>
                              {/* 右側：Checkbox 固定靠右垂直置中 */}
                              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', height: '100%' }}>
                                <Checkbox checked={selected} onChange={(e) => { e.stopPropagation(); toggleCase(caseGroup) }} />
                              </div>
                            </div>
                          </Card>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </Space>
        )}
      </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="評估指標說明" style={{ height: '100%' }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>

              <div>
                <Text strong style={{ fontSize: 14, color: '#00873e' }}>完全一致率（Exact Match）</Text>
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.8, color: '#374151' }}>
                  模型萃取結果與 Ground Truth <Text strong>完全相同</Text>（逐字符比對）才算命中。
                  計算方式：
                </div>
                <div style={{ margin: '8px 0', padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}>
                  完全一致率 = 完全一致筆數 / 總筆數 × 100%
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  適用欄位：姓名、性別、生日，容忍度為零。
                </Text>
              </div>

              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                <Text strong style={{ fontSize: 14, color: '#1677ff' }}>平均相似度（Jaccard Similarity）</Text>
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.8, color: '#374151' }}>
                  將萃取結果與 Ground Truth 各自拆成<Text strong>字符集合</Text>，計算交集佔聯集的比例。
                  計算方式：
                </div>
                <div style={{ margin: '8px 0', padding: '8px 12px', background: '#f5f5f5', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}>
                  Jaccard = |A ∩ B| / |A ∪ B|
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  適用欄位：<Text strong>出生地</Text>。出生地描述形式多樣（如「臺北市」與「台北市北投區」），允許部分相符，對多餘或缺漏字符有容忍空間。
                </Text>
              </div>

            </Space>
          </Card>
        </Col>
      </Row>

      {/* ── 開始分析按鈕 ── */}
      <Row justify="start">
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

          {/* ── 萃取完整度 ── */}
          {(() => {
            const counts = result.model_extraction_counts || {}
            const total = result.total_records

            const extractData = result.model_names.map((norm: string) => {
              const display = formatModelId(result.model_display_names[norm] || norm)
              const valid = counts[norm] ?? 0
              return { model: display, 萃取人數: valid, _color: modelColorMap[norm] ?? colors[0] }
            }).sort((a: any, b: any) => b['萃取人數'] - a['萃取人數'])

            return (
              <Card title="98篇法院判例中，各模型萃取出的被告人數">
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={extractData} margin={{ top: 24, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="model" tick={{ fontSize: 14 }} />
                    <YAxis domain={[0, Math.ceil(total * 1.1)]} tick={{ fontSize: 14 }} />
                    <ReTooltip
                      formatter={(v: any) => [`${v} 筆 (${(v / total * 100).toFixed(1)}%)`, '萃取人數']}
                    />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="萃取人數" radius={[4, 4, 0, 0]} name="萃取人數">
                      {extractData.map((d: any, i: number) => (
                        <Cell key={i} fill={d._color} />
                      ))}
                      <LabelList
                        dataKey="萃取人數"
                        position="inside"
                        formatter={(v: any) => `${v} (${(v / total * 100).toFixed(1)}%)`}
                        style={{ fontSize: 15, fill: '#000', fontWeight: 700 }}
                      />
                    </Bar>
                    <ReferenceLine
                      y={total}
                      stroke="#003a8c"
                      strokeDasharray="6 3"
                      strokeWidth={2}
                      label={{ value: `正確被告人數 ${total}`, position: 'insideTopRight', fill: '#003a8c', fontSize: 12, fontWeight: 600 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )
          })()}

          {/* 整體統計（預設收合） */}
          {overallStats && (
            <Collapse
              ghost
              style={{ background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0' }}
              items={[{
                key: 'overall',
                label: (
                  <Space>
                    <CheckCircleOutlined style={{ color: '#00873e' }} />
                    <Text strong>整體準確度統計</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>（共 {result.total_records} 筆記錄）</Text>
                  </Space>
                ),
                children: (
                  <Row gutter={[16, 16]}>
                    {result.model_names.map((modelId: string) => (
                      <Col xs={24} sm={12} key={modelId}>
                        <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                          <Text strong style={{ fontSize: 14, color: '#00873e', display: 'block', marginBottom: 12 }}>
                            {formatModelId(result.model_display_names[modelId] || modelId)}
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
                ),
              }]}
            />
          )}

          {/* 長條圖 */}
          <Card title={<span>各欄位準確度比較（完全一致率）<span style={{ fontWeight: 400, fontSize: 13, color: '#000', marginLeft: 8 }}>224位被告人在各模型萃取結果完全一致佔比</span></span>}>
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="field" tick={{ fontSize: 14 }} />
                <YAxis
                  label={{ value: '完全一致率 (%)', angle: -90, position: 'insideLeft', style: { fontSize: 14 } }}
                  domain={[0, 100]}
                  tick={{ fontSize: 14 }}
                />
                <ReTooltip formatter={(value: any) => `${value}%`} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                {result.model_names.map((modelId: string) => (
                  <Bar
                    key={modelId}
                    dataKey={modelId}
                    fill={modelColorMap[modelId]}
                    name={formatModelId(result.model_display_names[modelId] || modelId)}
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

          {/* ── 圖表一：指定欄位平均相似度 ── */}
          {(() => {
            const fieldOptions = [
              { value: 'NAME', label: '姓名 (NAME)' },
              { value: 'SEX', label: '性別 (SEX)' },
              { value: 'DATE_OF_BIRTH', label: '生日 (DATE_OF_BIRTH)' },
              { value: 'PLACE_OF_BIRTH', label: '出生地 (PLACE_OF_BIRTH)' },
            ]
            const fieldData = result.accuracy_summary
              .filter((r: any) => r['欄位'] === selectedField)
              .map((r: any) => ({
                normId: r['模型'],
                model: formatModelId(result.model_display_names[r['模型']] || r['模型']),
                平均相似度: parseFloat((r['平均相似度'] * 100).toFixed(2)),
                完全一致率: parseFloat((r['完全一致率'] * 100).toFixed(2)),
                中位數相似度: parseFloat((r['中位數相似度'] * 100).toFixed(2)),
                完全一致數: r['完全一致數'],
                完全不一致數: r['完全不一致數'],
                總筆數: r['總筆數'],
              }))
              .sort((a: any, b: any) => b['平均相似度'] - a['平均相似度'])

            const rankCols = [
              { title: '排名', key: 'rank', width: 60, render: (_: any, __: any, i: number) => <Text strong>{i + 1}</Text> },
              { title: '模型', dataIndex: 'model', key: 'model', render: (v: string) => <Text strong>{v}</Text> },
              { title: '平均相似度', dataIndex: '平均相似度', key: 'sim', width: 120,
                render: (v: number) => <Text style={{ color: v >= 80 ? '#3f8600' : v >= 60 ? '#fa8c16' : '#cf1322', fontWeight: 600 }}>{v.toFixed(2)}%</Text> },
              { title: '中位數相似度', dataIndex: '中位數相似度', key: 'med', width: 120,
                render: (v: number) => `${v.toFixed(2)}%` },
              { title: '完全一致率', dataIndex: '完全一致率', key: 'exact', width: 110,
                render: (v: number) => `${v.toFixed(2)}%` },
              { title: '完全一致數', dataIndex: '完全一致數', key: 'exactN', width: 100 },
              { title: '完全不一致數', dataIndex: '完全不一致數', key: 'noneN', width: 110 },
              { title: '總筆數', dataIndex: '總筆數', key: 'total', width: 80 },
            ]

            return (
              <Card
                title="欄位平均相似度排名"
                extra={
                  <Select
                    value={selectedField}
                    onChange={setSelectedField}
                    options={fieldOptions}
                    style={{ width: 200 }}
                    size="small"
                  />
                }
              >
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={fieldData} margin={{ top: 24, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="model" tick={{ fontSize: 14 }} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 14 }} />
                    <ReTooltip formatter={(v: any, name: string) => [`${v}%`, name]} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="平均相似度" radius={[4, 4, 0, 0]} name="平均相似度">
                      {fieldData.map((d: any, i: number) => (
                        <Cell key={i} fill={modelColorMap[d.normId] ?? colors[i % colors.length]} />
                      ))}
                      <LabelList dataKey="平均相似度" position="top" formatter={(v: any) => `${v}%`} style={{ fontSize: 12, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <Table
                  columns={rankCols}
                  dataSource={fieldData}
                  rowKey="model"
                  size="small"
                  pagination={false}
                  style={{ marginTop: 16 }}
                />
              </Card>
            )
          })()}

        </Space>
      )}
    </Space>

    <Modal
      title="Prompt 內容"
      open={promptModal.open}
      onCancel={() => setPromptModal({ open: false, content: '' })}
      footer={null}
      width={680}
    >
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.7, maxHeight: 480, overflowY: 'auto', background: '#fafafa', padding: 16, borderRadius: 6, border: '1px solid #f0f0f0' }}>
        {promptModal.content}
      </pre>
    </Modal>
    </>
  )
}

export default AnalyzePage
