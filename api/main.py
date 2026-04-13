"""
FastAPI 後端服務
提供 PDF 萃取、準確度分析等 REST API
"""
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from pathlib import Path
import json
import asyncio
import threading
import pandas as pd
from datetime import datetime, timezone
import logging
import tempfile
import traceback
import os

# ============================================================================
# Logging 設定 - 寫入 backend.log
# ============================================================================
LOG_FILE = Path(__file__).parent.parent / "backend.log"

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler()  # 同時輸出到終端
    ]
)
logger = logging.getLogger("api")

logger.info("=" * 60)
logger.info("後端啟動中...")

# 強制清除可能引發錯誤的殘留環境變數
if 'GOOGLE_APPLICATION_CREDENTIALS' in os.environ:
    old_cred = os.environ['GOOGLE_APPLICATION_CREDENTIALS']
    logger.warning(f"偵測到殘留的憑證變數: {old_cred}，將強制清除並使用 ADC！")
    del os.environ['GOOGLE_APPLICATION_CREDENTIALS']
else:
    logger.info("未偵測到 GOOGLE_APPLICATION_CREDENTIALS，將正常使用 ADC。")

logger.info("=" * 60)

# 本地模組
import sys
sys.path.append(str(Path(__file__).parent.parent))

from dashboard.config import (
    ModelConfig,
    EXTRACT_DIR,
    OUTPUT_DIR,
    PDF_DIR,
    GROUND_TRUTH_FILE,
    get_extract_filename,
    get_jsonl_filename,
    extract_model_id_from_filename,
    SYSTEM_PROMPT
)
from dashboard.extractor import PDFExtractor
from dashboard.analyzer import AccuracyAnalyzer
from dashboard.bq_client import BQClient

# ============================================================================
# FastAPI 應用初始化
# ============================================================================
app = FastAPI(
    title="LLM 萃取準確度監控 API",
    description="提供 PDF 萃取、準確度分析等功能",
    version="1.0.0"
)

# CORS 設定 - 允許 React 前端跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite 和 CRA 預設埠
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Pydantic 資料模型
# ============================================================================
class ExtractRequest(BaseModel):
    """PDF 萃取請求"""
    gcp_project: str
    model_id: str
    provider: str
    location: str
    temperature: float = 0.0
    system_prompt: Optional[str] = None
    num_files: Optional[int] = None  # 要處理的檔案數量（當 pdf_files 為空時使用）
    pdf_files: Optional[List[str]] = None  # 指定要處理的檔案名稱列表
    max_runtime_minutes: Optional[int] = None  # 最大執行時間（分鐘）

class AnalyzeRequest(BaseModel):
    """準確度分析請求"""
    model_files: List[str]  # 模型萃取結果檔案名稱列表

class ModelInfo(BaseModel):
    """模型資訊"""
    model_id: str
    file_name: str
    file_path: str
    file_size: int
    record_count: int  # CSV 檔案的記錄數量
    modified_time: str

class BQAnalyzeRequest(BaseModel):
    """BQ 準確度分析請求"""
    run_ids: List[str]

class BQImportRequest(BaseModel):
    """JSONL 匯入 BQ 請求"""
    jsonl_file: str        # OUTPUT_DIR 內的檔名
    model_id: str
    provider: str
    location: str
    prompt: Optional[str] = None

class BQImportCsvRequest(BaseModel):
    """CSV 匯入 BQ 請求（data/extracts/ 內的 CSV）"""
    csv_file: str          # EXTRACT_DIR 內的檔名
    provider: str          # model_id 從 CSV MODEL 欄或檔名自動取得
    location: str = "us-central1"
    prompt: Optional[str] = None

# ============================================================================
# BQ 客戶端 helper
# ============================================================================
def _get_bq(gcp_project: str = None) -> BQClient:
    try:
        return BQClient(gcp_project=gcp_project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BigQuery 連線失敗: {e}")

# ============================================================================
# WebSocket 連接管理
# ============================================================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# ============================================================================
# API 路由
# ============================================================================

@app.get("/")
async def root():
    """根路徑"""
    return {
        "message": "LLM 萃取準確度監控 API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/api/health")
async def health_check():
    """健康檢查"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/config")
async def get_config():
    """取得系統配置資訊"""
    pdf_count = len(list(PDF_DIR.glob("*.pdf")))
    extract_files = list(EXTRACT_DIR.glob("*.csv"))
    
    return {
        "pdf_dir": str(PDF_DIR),
        "pdf_count": pdf_count,
        "extract_dir": str(EXTRACT_DIR),
        "extract_count": len(extract_files),
        "ground_truth_file": str(GROUND_TRUTH_FILE),
        "ground_truth_exists": GROUND_TRUTH_FILE.exists(),
        "system_prompt": SYSTEM_PROMPT
    }

@app.get("/api/models", response_model=List[ModelInfo])
async def list_models():
    """列出所有已萃取的模型結果"""
    models = []
    
    for csv_file in EXTRACT_DIR.glob("*.csv"):
        try:
            model_id = extract_model_id_from_filename(csv_file.name)
            stat = csv_file.stat()
            
            # 讀取 CSV 檔案以取得記錄數量
            try:
                df = pd.read_csv(csv_file)
                record_count = len(df)
            except Exception as read_error:
                print(f"讀取 CSV 失敗 {csv_file.name}: {read_error}")
                record_count = 0
            
            models.append(ModelInfo(
                model_id=model_id,
                file_name=csv_file.name,
                file_path=str(csv_file),
                file_size=stat.st_size,
                record_count=record_count,
                modified_time=datetime.fromtimestamp(stat.st_mtime).isoformat()
            ))
        except Exception as e:
            print(f"解析檔案失敗 {csv_file.name}: {e}")
            continue
    
    # 按修改時間排序（最新的在前）
    models.sort(key=lambda x: x.modified_time, reverse=True)
    return models

@app.get("/api/pdf-files")
async def list_pdf_files():
    """列出所有 PDF 檔案"""
    pdf_files = []
    
    for pdf_file in PDF_DIR.glob("*.pdf"):
        stat = pdf_file.stat()
        pdf_files.append({
            "name": pdf_file.name,
            "path": str(pdf_file),
            "size": stat.st_size,
            "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat()
        })
    
    pdf_files.sort(key=lambda x: x["name"])
    return pdf_files

@app.post("/api/extract")
async def extract_pdfs(request: ExtractRequest):
    """執行 PDF 萃取（異步）"""
    try:
        # 建立模型配置
        model_config = ModelConfig(
            model_id=request.model_id,
            provider=request.provider,
            location=request.location,
            temperature=request.temperature
        )
        
        # 初始化萃取器
        extractor = PDFExtractor(
            model_config=model_config,
            gcp_project=request.gcp_project,
            system_prompt=request.system_prompt or SYSTEM_PROMPT
        )
        
        # 取得要處理的 PDF 檔案
        if request.pdf_files:
            # 使用指定的檔案列表
            pdf_files = [PDF_DIR / filename for filename in request.pdf_files]
            # 驗證檔案是否存在
            pdf_files = [f for f in pdf_files if f.exists()]
            if not pdf_files:
                raise HTTPException(status_code=404, detail="指定的 PDF 檔案不存在")
            
            print(f"\n{'='*60}")
            print(f"📊 萃取請求:")
            print(f"  - 模型: {request.model_id}")
            print(f"  - 處理模式: 指定檔案")
            print(f"  - 選擇檔案數: {len(pdf_files)}")
            print(f"  - 時間限制: {request.max_runtime_minutes} 分鐘" if request.max_runtime_minutes else "  - 時間限制: 無")
            print(f"  - 選擇檔案: {[f.name for f in pdf_files[:3]]}..." if len(pdf_files) > 3 else f"  - 選擇檔案: {[f.name for f in pdf_files]}")
            print(f"{'='*60}\n")
        else:
            # 取得所有檔案並根據 num_files 參數決定數量
            all_pdf_files = sorted(PDF_DIR.glob("*.pdf"))
            
            if not all_pdf_files:
                raise HTTPException(status_code=404, detail="找不到 PDF 檔案")
            
            num_files_to_process = request.num_files or len(all_pdf_files)
            num_files_to_process = min(num_files_to_process, len(all_pdf_files))
            
            pdf_files = all_pdf_files[:num_files_to_process]
            
            print(f"\n{'='*60}")
            print(f"📊 萃取請求:")
            print(f"  - 模型: {request.model_id}")
            print(f"  - 處理模式: 範圍選擇")
            print(f"  - 總 PDF 檔案數: {len(all_pdf_files)}")
            print(f"  - 請求處理數量: {request.num_files}")
            print(f"  - 實際處理數量: {num_files_to_process}")
            print(f"  - 時間限制: {request.max_runtime_minutes} 分鐘" if request.max_runtime_minutes else "  - 時間限制: 無")
            print(f"{'='*60}\n")
        
        # 準備輸出檔案
        csv_filename = get_extract_filename(request.model_id)
        jsonl_filename = get_jsonl_filename(request.model_id)
        csv_path = EXTRACT_DIR / csv_filename
        jsonl_path = OUTPUT_DIR / jsonl_filename
        
        # 錯誤和成功計數（使用 lock 保護，多線程安全）
        success_count = 0
        error_count = 0
        count_lock = threading.Lock()

        loop = asyncio.get_running_loop()

        # 進度回調函數（會在多個子執行緒中並行觸發）
        def progress_callback(current, total, filename, status, error_msg=None):
            nonlocal success_count, error_count

            with count_lock:
                if status == "success":
                    success_count += 1
                elif status == "error":
                    error_count += 1

            # 使用 run_coroutine_threadsafe 來跨執行緒廣播進度
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({
                    "type": "progress",
                    "current": current,
                    "total": total,
                    "file": filename,
                    "status": status,
                    "error": error_msg
                }),
                loop
            )
        
        # 執行批次萃取 (使用 asyncio.to_thread 避免阻塞 event loop)
        pdf_file_names = [pdf.name for pdf in pdf_files]
        started_at = datetime.now(timezone.utc)

        result_df = await asyncio.to_thread(
            extractor.batch_extract,
            pdf_files=pdf_file_names,
            output_jsonl=jsonl_path,
            output_csv=csv_path,
            progress_callback=progress_callback,
            max_runtime_minutes=request.max_runtime_minutes
        )

        completed_at = datetime.now(timezone.utc)

        # 萃取完成後非同步寫入 BigQuery（失敗不影響主流程）
        bq_run_id = None
        try:
            defendants = []
            if jsonl_path.exists():
                with open(jsonl_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                defendants.append(json.loads(line))
                            except Exception:
                                pass

            prompt_used = request.system_prompt or SYSTEM_PROMPT
            bq = await asyncio.to_thread(_get_bq, request.gcp_project)
            bq_run_id = BQClient.make_run_id()

            await asyncio.to_thread(
                bq.save_run,
                run_id=bq_run_id,
                model_id=request.model_id,
                provider=request.provider,
                location=request.location,
                gcp_project=request.gcp_project,
                prompt=prompt_used,
                started_at=started_at,
                completed_at=completed_at,
                total_files=len(pdf_files),
                success_count=success_count,
                error_count=error_count,
            )
            if defendants:
                await asyncio.to_thread(
                    bq.save_extractions,
                    run_id=bq_run_id,
                    model_id=request.model_id,
                    prompt=prompt_used,
                    defendants=defendants,
                    extracted_at=completed_at,
                )
            logger.info(f"✅ BQ 寫入成功: run_id={bq_run_id}")
        except Exception as bq_err:
            logger.warning(f"⚠️ BQ 寫入失敗（不影響萃取結果）: {bq_err}")

        # 廣播完成
        await manager.broadcast({
            "type": "complete",
            "total": len(pdf_files),
            "success": success_count,
            "errors": error_count,
            "csv_file": csv_filename
        })

        return {
            "status": "success",
            "total": len(pdf_files),
            "success": success_count,
            "errors": error_count,
            "csv_file": csv_filename,
            "jsonl_file": jsonl_filename,
            "bq_run_id": bq_run_id,
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze")
async def analyze_accuracy(request: AnalyzeRequest):
    """分析模型準確度"""
    try:
        # 載入基準資料
        if not GROUND_TRUTH_FILE.exists():
            raise HTTPException(status_code=404, detail="找不到基準資料檔案")
        
        ground_truth_df = pd.read_csv(GROUND_TRUTH_FILE)
        analyzer = AccuracyAnalyzer(ground_truth_df)
        
        # 載入各模型結果
        model_dfs = {}
        model_display_names = {}
        
        for file_name in request.model_files:
            file_path = EXTRACT_DIR / file_name
            if not file_path.exists():
                continue
            
            # 讀取 CSV
            df = pd.read_csv(file_path)
            original_model_id = extract_model_id_from_filename(file_name)
            
            # 載入模型結果（會自動規範化模型名稱）
            model_df = analyzer.load_model_result(df, original_model_id)
            
            # 使用規範化的模型名稱
            normalized_model_id = analyzer._normalize_model_name(original_model_id)
            model_dfs[normalized_model_id] = model_df
            model_display_names[normalized_model_id] = original_model_id
        
        if not model_dfs:
            raise HTTPException(status_code=404, detail="找不到指定的模型結果檔案")
        
        # 合併結果
        merged_df = analyzer.merge_results(model_dfs)
        
        # 計算準確度（會返回兩個 DataFrame）
        accuracy_df, detailed_df = analyzer.calculate_accuracy(
            merged_df,
            list(model_dfs.keys())
        )
        
        # 計算姓名準確度
        name_accuracy_df = analyzer.calculate_name_accuracy(
            merged_df,
            list(model_dfs.keys())
        )
        
        # 合併姓名準確度
        full_accuracy_df = pd.concat([name_accuracy_df, accuracy_df], axis=0).reset_index(drop=True)
        
        # 轉換為 JSON 格式
        response_data = {
            "success": True,
            "model_names": list(model_dfs.keys()),
            "model_display_names": model_display_names,
            "accuracy_summary": full_accuracy_df.to_dict(orient='records'),
            "field_list": ['NAME', 'SEX', 'DATE_OF_BIRTH', 'DATE_OF_BIRTH_YEAR', 'PLACE_OF_BIRTH'],
            "total_records": len(merged_df)
        }
        
        return response_data
        
    except Exception as e:
        import traceback
        error_detail = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        raise HTTPException(status_code=500, detail=str(error_detail))

@app.delete("/api/models/{file_name}")
async def delete_model_file(file_name: str):
    """刪除模型萃取結果檔案"""
    try:
        csv_path = EXTRACT_DIR / file_name
        
        if not csv_path.exists():
            raise HTTPException(status_code=404, detail="檔案不存在")
        
        # 同時刪除對應的 JSONL 檔案
        model_id = extract_model_id_from_filename(file_name)
        jsonl_filename = get_jsonl_filename(model_id)
        jsonl_path = OUTPUT_DIR / jsonl_filename
        
        csv_path.unlink()
        if jsonl_path.exists():
            jsonl_path.unlink()
        
        return {
            "status": "success",
            "message": f"已刪除 {file_name}",
            "deleted_files": [file_name, jsonl_filename if jsonl_path.exists() else None]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/download/{file_name}")
async def download_file(file_name: str):
    """下載萃取結果檔案"""
    file_path = EXTRACT_DIR / file_name
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="檔案不存在")
    
    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="text/csv"
    )

# ============================================================================
# BigQuery API 路由
# ============================================================================

@app.get("/api/bq/status")
async def bq_status():
    """BigQuery 連線與各表格狀態"""
    bq = await asyncio.to_thread(_get_bq)
    return await asyncio.to_thread(bq.status)

@app.get("/api/bq/runs")
async def list_bq_runs():
    """列出所有 BQ 執行紀錄（最新在前）"""
    bq = await asyncio.to_thread(_get_bq)
    return await asyncio.to_thread(bq.list_runs)

@app.get("/api/bq/jsonl-files")
async def list_jsonl_files():
    """列出 outputs 目錄中可匯入的 JSONL 檔案"""
    files = []
    for jsonl_file in OUTPUT_DIR.glob("*.jsonl"):
        stat = jsonl_file.stat()
        files.append({
            "name": jsonl_file.name,
            "size": stat.st_size,
            "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    files.sort(key=lambda x: x["modified_time"], reverse=True)
    return files

@app.get("/api/extract-files")
async def list_extract_files():
    """列出 data/extracts/ 內所有 CSV 萃取結果"""
    files = []
    for csv_file in EXTRACT_DIR.glob("*.csv"):
        try:
            df = pd.read_csv(csv_file)
            model_id = str(df["MODEL"].dropna().iloc[0]) if "MODEL" in df.columns and df["MODEL"].notna().any() \
                       else extract_model_id_from_filename(csv_file.name)
            record_count = len(df)
        except Exception:
            model_id = extract_model_id_from_filename(csv_file.name)
            record_count = 0
        files.append({
            "file_name":    csv_file.name,
            "model_id":     model_id,
            "record_count": record_count,
            "file_size":    csv_file.stat().st_size,
            "modified_time": datetime.fromtimestamp(csv_file.stat().st_mtime).isoformat(),
        })
    files.sort(key=lambda x: x["modified_time"], reverse=True)
    return files

@app.post("/api/bq/import-csv")
async def import_csv_to_bq(request: BQImportCsvRequest):
    """將 data/extracts/ 的 CSV 匯入 BigQuery（extraction_runs + extractions 兩張表）"""
    csv_path = EXTRACT_DIR / request.csv_file
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail=f"找不到檔案: {request.csv_file}")

    bq = await asyncio.to_thread(_get_bq)
    run_id = await asyncio.to_thread(
        bq.import_csv,
        csv_path=csv_path,
        provider=request.provider,
        location=request.location,
        prompt=request.prompt or SYSTEM_PROMPT,
    )
    return {"status": "success", "run_id": run_id, "target_tables": ["extraction_runs", "extractions"]}

@app.post("/api/bq/import-jsonl")
async def import_jsonl_to_bq(request: BQImportRequest):
    """將指定 JSONL 檔案匯入 BigQuery"""
    jsonl_path = OUTPUT_DIR / request.jsonl_file
    if not jsonl_path.exists():
        raise HTTPException(status_code=404, detail=f"找不到檔案: {request.jsonl_file}")

    bq = await asyncio.to_thread(_get_bq)
    run_id = await asyncio.to_thread(
        bq.import_jsonl,
        jsonl_path=jsonl_path,
        model_id=request.model_id,
        provider=request.provider,
        location=request.location,
        prompt=request.prompt or SYSTEM_PROMPT,
    )
    return {"status": "success", "run_id": run_id}

@app.post("/api/bq/upload-ground-truth")
async def upload_ground_truth_to_bq(file: UploadFile = File(...)):
    """上傳 Ground Truth CSV 至 BigQuery（全量覆寫）"""
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        bq = await asyncio.to_thread(_get_bq)
        count = await asyncio.to_thread(bq.upload_ground_truth, tmp_path)
        return {"status": "success", "count": count}
    finally:
        tmp_path.unlink(missing_ok=True)

class BQDeleteRunsRequest(BaseModel):
    run_ids: List[str]

@app.delete("/api/bq/runs")
async def delete_bq_runs(request: BQDeleteRunsRequest):
    """刪除指定 run_id 的執行紀錄及其所有萃取結果"""
    if not request.run_ids:
        raise HTTPException(status_code=400, detail="請提供至少一個 run_id")
    bq = await asyncio.to_thread(_get_bq)
    count = await asyncio.to_thread(bq.delete_runs, request.run_ids)
    return {"status": "success", "deleted_runs": count}

@app.delete("/api/bq/ground-truth")
async def clear_ground_truth():
    """清空 ground_truth 表"""
    bq = await asyncio.to_thread(_get_bq)
    await asyncio.to_thread(bq.truncate_ground_truth)
    return {"status": "success"}

@app.get("/api/bq/runs/{run_id}/extractions")
async def get_run_extractions(run_id: str):
    """查詢單一 run 的萃取明細"""
    bq = await asyncio.to_thread(_get_bq)
    df = await asyncio.to_thread(bq.get_extractions_by_runs, [run_id])
    if df.empty:
        return []
    ALL_EXTRACT_COLS = ["run_id", "model_id", "prompt_hash", "extracted_at",
                        "doc_id", "file_name", "case_link",
                        "NAME", "SEX", "DATE_OF_BIRTH", "PLACE_OF_BIRTH", "raw_json"]
    cols = [c for c in ALL_EXTRACT_COLS if c in df.columns]
    return df[cols].fillna("").to_dict(orient="records")

@app.get("/api/bq/extractions")
async def get_all_extractions(limit: int = 1000):
    """查詢 extractions 表所有資料"""
    try:
        bq = await asyncio.to_thread(_get_bq)
        df = await asyncio.to_thread(bq.get_all_extractions, limit)
        if df.empty:
            return []
        ALL_EXTRACT_COLS = ["run_id", "model_id", "prompt_hash", "extracted_at",
                            "doc_id", "file_name", "case_link",
                            "NAME", "SEX", "DATE_OF_BIRTH", "PLACE_OF_BIRTH", "raw_json"]
        cols = [c for c in ALL_EXTRACT_COLS if c in df.columns]
        return df[cols].fillna("").to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze-bq")
async def analyze_accuracy_bq(request: BQAnalyzeRequest):
    """使用 BigQuery 資料進行準確度分析"""
    try:
        bq = await asyncio.to_thread(_get_bq)

        # 取得萃取資料
        extractions_df = await asyncio.to_thread(bq.get_extractions_by_runs, request.run_ids)
        if extractions_df.empty:
            raise HTTPException(status_code=404, detail="找不到指定的萃取資料")

        # 取得 ground truth
        ground_truth_df = await asyncio.to_thread(bq.get_ground_truth)
        if ground_truth_df.empty:
            raise HTTPException(status_code=404, detail="找不到 Ground Truth，請先上傳")

        analyzer = AccuracyAnalyzer(ground_truth_df)

        model_dfs = {}
        model_display_names = {}

        for model_id in extractions_df["model_id"].unique():
            subset = extractions_df[extractions_df["model_id"] == model_id].copy()
            df = subset[["file_name", "NAME", "SEX", "DATE_OF_BIRTH", "PLACE_OF_BIRTH", "case_link"]].copy()
            df = df.rename(columns={"case_link": "CASE_LINK"})

            loaded = analyzer.load_model_result(df, model_id)
            norm_id = analyzer._normalize_model_name(model_id)
            model_dfs[norm_id] = loaded
            model_display_names[norm_id] = model_id

        if not model_dfs:
            raise HTTPException(status_code=404, detail="無法載入任何模型資料")

        merged_df = analyzer.merge_results(model_dfs)
        accuracy_df, _ = analyzer.calculate_accuracy(merged_df, list(model_dfs.keys()))
        name_accuracy_df = analyzer.calculate_name_accuracy(merged_df, list(model_dfs.keys()))
        full_accuracy_df = pd.concat([name_accuracy_df, accuracy_df], axis=0).reset_index(drop=True)

        return {
            "success": True,
            "model_names": list(model_dfs.keys()),
            "model_display_names": model_display_names,
            "accuracy_summary": full_accuracy_df.to_dict(orient="records"),
            "field_list": ["NAME", "SEX", "DATE_OF_BIRTH", "DATE_OF_BIRTH_YEAR", "PLACE_OF_BIRTH"],
            "total_records": len(merged_df),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/progress")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 連接 - 即時進度推送"""
    await manager.connect(websocket)
    try:
        while True:
            # 保持連接
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ============================================================================
# 啟動說明
# ============================================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
