import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000, // 5 分鐘超時（因為萃取可能需要較長時間）
  headers: {
    'Content-Type': 'application/json',
  },
})

// 請求攔截器
api.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 回應攔截器
api.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    const message = error.response?.data?.detail || error.message || '請求失敗'
    return Promise.reject(new Error(message))
  }
)

// ============================================================================
// API 方法
// ============================================================================

export interface ExtractRequest {
  gcp_project: string;
  model_id: string;
  provider: string;
  location: string;
  temperature?: number;
  system_prompt?: string;
  num_files?: number;
  pdf_files?: string[];  // 指定要處理的檔案名稱列表
  max_runtime_minutes?: number;
}

export interface ModelInfo {
  model_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  record_count: number;  // CSV 記錄數量
  modified_time: string;
}

export interface AnalyzeRequest {
  model_files: string[]
}

export interface BQRun {
  run_id: string
  model_id: string
  provider: string
  prompt_hash: string
  prompt_preview: string
  started_at: string
  completed_at: string
  total_files: number
  success_count: number
  error_count: number
}

export interface BQStatus {
  dataset: string
  project: string
  tables: Record<string, { exists: boolean; rows: number }>
}

export interface BQAnalyzeRequest {
  run_ids: string[]
}

export interface BQImportRequest {
  jsonl_file: string
  model_id: string
  provider: string
  location: string
  prompt?: string
}

export interface BQImportCsvRequest {
  csv_file: string
  provider: string
  location?: string
  prompt?: string
}

export interface ExtractFileInfo {
  file_name: string
  model_id: string
  record_count: number
  file_size: number
  modified_time: string
}

export interface ConfigInfo {
  pdf_dir: string
  pdf_count: number
  extract_dir: string
  extract_count: number
  ground_truth_file: string
  ground_truth_exists: boolean
  system_prompt: string
}

// 取得系統配置
export const getConfig = (): Promise<ConfigInfo> => {
  return api.get('/api/config')
}

// 列出所有模型結果
export const listModels = (): Promise<ModelInfo[]> => {
  return api.get('/api/models')
}

// 列出 PDF 檔案
export const listPdfFiles = (): Promise<any[]> => {
  return api.get('/api/pdf-files')
}

// 執行 PDF 萃取
export const extractPdfs = (request: ExtractRequest): Promise<any> => {
  return api.post('/api/extract', request)
}

// 分析準確度
export const analyzeAccuracy = (request: AnalyzeRequest): Promise<any> => {
  return api.post('/api/analyze', request)
}

// 刪除模型檔案
export const deleteModelFile = (fileName: string): Promise<any> => {
  return api.delete(`/api/models/${fileName}`)
}

// 下載檔案
export const downloadFile = (fileName: string): string => {
  return `${API_BASE_URL}/api/download/${fileName}`
}

// ============================================================================
// BigQuery API 方法
// ============================================================================

// BQ 狀態
export const getBQStatus = (): Promise<BQStatus> => {
  return api.get('/api/bq/status')
}

// 列出 BQ 執行紀錄
export const listBQRuns = (): Promise<BQRun[]> => {
  return api.get('/api/bq/runs')
}

// 列出可匯入的 JSONL 檔案
export const listJsonlFiles = (): Promise<any[]> => {
  return api.get('/api/bq/jsonl-files')
}

// 列出 data/extracts/ 的 CSV 萃取結果
export const listExtractFiles = (): Promise<ExtractFileInfo[]> => {
  return api.get('/api/extract-files')
}

// 匯入 CSV 至 BQ（→ extraction_runs + extractions）
export const importCsvToBQ = (request: BQImportCsvRequest): Promise<any> => {
  return api.post('/api/bq/import-csv', request)
}

// 匯入 JSONL 至 BQ
export const importJsonlToBQ = (request: BQImportRequest): Promise<any> => {
  return api.post('/api/bq/import-jsonl', request)
}

// 上傳 Ground Truth 至 BQ
export const uploadGroundTruth = (file: File): Promise<any> => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post('/api/bq/upload-ground-truth', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// BQ 準確度分析
export const analyzeAccuracyBQ = (request: BQAnalyzeRequest): Promise<any> => {
  return api.post('/api/analyze-bq', request)
}

// 刪除指定 run（含其萃取結果）
export const deleteBQRuns = (runIds: string[]): Promise<any> => {
  return api.delete('/api/bq/runs', { data: { run_ids: runIds } })
}

// 清空 ground_truth 表
export const clearGroundTruth = (): Promise<any> => {
  return api.delete('/api/bq/ground-truth')
}

// 查詢單一 run 的萃取明細
export const getRunExtractions = (runId: string): Promise<any[]> => {
  return api.get(`/api/bq/runs/${runId}/extractions`)
}

// WebSocket 連接
export const createWebSocket = (onMessage: (data: any) => void): WebSocket => {
  const wsUrl = API_BASE_URL.replace('http', 'ws')
  const ws = new WebSocket(`${wsUrl}/ws/progress`)
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    onMessage(data)
  }
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
  }
  
  return ws
}

export default api
