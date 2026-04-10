"""
PDF 萃取服務模組
負責從 PDF 檔案萃取結構化資料
"""
import io
import json
import re
import time
import traceback
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Dict, Any, Optional
import pandas as pd

# GCP & AI 套件
from google.cloud import storage
from google import genai
from google.genai import types
from google.genai.errors import ClientError
from anthropic import AnthropicVertex
from anthropic import RateLimitError
import pypdf
from pypdf import PdfReader

# 本地配置
from .config import (
    GCP_PROJECT,
    BUCKET_NAME,
    PDF_PREFIX,
    SYSTEM_PROMPT,
    ModelConfig,
    OUTPUT_DIR,
    PDF_DIR
)


class PDFExtractor:
    """PDF 萃取器"""
    
    def __init__(self, model_config: ModelConfig, gcp_project: str = None, system_prompt: str = None):
        """
        初始化萃取器
        
        Args:
            model_config: 模型配置
            gcp_project: GCP 專案 ID（可選，預設使用 config 中的設定）
            system_prompt: 自訂 system prompt（可選，預設使用 SYSTEM_PROMPT）
        """
        self.model_config = model_config
        self.gcp_project = gcp_project or GCP_PROJECT
        self.system_prompt = system_prompt or SYSTEM_PROMPT  # 使用自訂或預設 prompt
        
        # 初始化 GCP 客戶端
        self.gcs_client = storage.Client(project=self.gcp_project)
        
        # 根據 provider 初始化對應的 AI 客戶端
        if model_config.provider == "gemini":
            self.genai_client = genai.Client(
                vertexai=True,
                project=self.gcp_project,
                location=model_config.location
            )
            self.claude_client = None
        elif model_config.provider == "claude":
            self.claude_client = AnthropicVertex(
                region=model_config.location,
                project_id=self.gcp_project
            )
            self.genai_client = None
        else:
            raise ValueError(f"不支援的 provider: {model_config.provider}")
        
    def extract_doc_id_from_link(self, link: str) -> str:
        """從 CASE_LINK 提取 DOC_ID"""
        pattern = re.compile(r"https?://[^/]+/([^/]+)/")
        match = pattern.search(link)
        if not match:
            raise ValueError(f"無法解析 DOC_ID：{link}")
        return match.group(1)
    
    def download_pdf_from_gcs(self, doc_id: str) -> bytes:
        """從 GCS 下載 PDF"""
        blob_path = f"{PDF_PREFIX}/{doc_id}.pdf"
        blob = self.gcs_client.bucket(BUCKET_NAME).blob(blob_path)
        if not blob.exists():
            raise FileNotFoundError(f"GCS 無檔案：gs://{BUCKET_NAME}/{blob_path}")
        return blob.download_as_bytes()
    
    def load_pdf_from_local(self, pdf_filename: str) -> bytes:
        """從本地檔案夾載入 PDF"""
        pdf_path = PDF_DIR / pdf_filename
        if not pdf_path.exists():
            raise FileNotFoundError(f"本地無檔案：{pdf_path}")
        return pdf_path.read_bytes()
    
    def pdf_to_text(self, pdf_bytes: bytes) -> str:
        """將 PDF 轉換為文字"""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    
    def call_llm(self, court_text: str) -> str:
        """呼叫 LLM 進行萃取"""
        if self.model_config.provider == "gemini":
            return self._call_gemini(court_text)
        elif self.model_config.provider == "claude":
            return self._call_claude(court_text)
        else:
            raise ValueError(f"不支援的 provider: {self.model_config.provider}")
    
    def _call_gemini(self, court_text: str) -> str:
        """呼叫 Gemini 模型（包含重試機制）"""
        contents = [types.Content(
            role="user",
            parts=[types.Part.from_text(text=court_text)]
        )]
        
        generate_config = types.GenerateContentConfig(
            temperature=self.model_config.temperature,
            response_mime_type=self.model_config.response_mime_type,
            system_instruction=[types.Part.from_text(text=self.system_prompt)],
            safety_settings=[
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
            ],
        )
        
        # 重試機制處理 429 錯誤
        max_retries = 5
        base_delay = 2  # 基礎延遲秒數
        
        for attempt in range(max_retries):
            try:
                result_json = ""
                for chunk in self.genai_client.models.generate_content_stream(
                    model=self.model_config.model_id,
                    contents=contents,
                    config=generate_config,
                ):
                    result_json += chunk.text or ""
                
                return result_json
                
            except ClientError as e:
                # 檢查是否為 429 錯誤
                if e.status_code == 429:
                    if attempt < max_retries - 1:
                        # 指數退避延遲: 2, 4, 8, 16, 32 秒
                        delay = base_delay * (2 ** attempt)
                        print(f"⚠️ 遇到速率限制 (429)，{delay} 秒後重試... (嘗試 {attempt + 1}/{max_retries})")
                        time.sleep(delay)
                        continue
                    else:
                        # 最後一次重試也失敗，拋出錯誤
                        raise ClientError(e.status_code, e.error, e.response) from e
                else:
                    # 非 429 錯誤，直接拋出
                    raise
            except Exception as e:
                # 其他錯誤也直接拋出
                raise
        
        raise RuntimeError("重試次數已達上限")
    
    def _call_claude(self, court_text: str) -> str:
        """呼叫 Claude 模型（透過 Vertex AI），包含重試邏輯"""
        max_retries = 5
        base_delay = 2  # 基礎延遲秒數
        
        for attempt in range(max_retries):
            try:
                message = self.claude_client.messages.create(
                    model=self.model_config.model_id,
                    max_tokens=4096,
                    temperature=self.model_config.temperature,
                    system=self.system_prompt,
                    messages=[
                        {"role": "user", "content": court_text}
                    ]
                )
                return message.content[0].text if message.content else ""
                
            except RateLimitError as e:
                # 檢查是否為 429 錯誤
                if attempt < max_retries - 1:
                    # 指數退避延遲: 2, 4, 8, 16, 32 秒
                    delay = base_delay * (2 ** attempt)
                    print(f"⚠️ Claude 遇到速率限制 (429)，{delay} 秒後重試... (嘗試 {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                else:
                    # 最後一次重試也失敗，拋出錯誤
                    raise
            except Exception as e:
                # 其他錯誤直接拋出
                raise
        
        raise RuntimeError("Claude 重試次數已達上限")
    
    def parse_llm_response(self, raw_json: str) -> List[Dict[str, Any]]:
        """解析 LLM 回傳的 JSON"""
        # 移除 markdown fence
        raw_json = re.sub(r"```(?:json)?\s*|\s*```", "", raw_json)
        raw_json = raw_json.lstrip("\ufeff").replace("\u00A0", " ")
        raw_json = raw_json.replace("\u2028", "\n").replace("\u2029", "\n")
        
        # 處理空陣列
        if raw_json.strip() == "[]":
            return []
        
        # 擷取 JSON 部分
        start, end = raw_json.find("{"), raw_json.rfind("}")
        if start == -1 or end == -1:
            candidate = raw_json
        else:
            candidate = raw_json[start:end+1]
        
        # 處理多個頂層物件
        candidate = self._wrap_multiple_objects(candidate)
        
        # Python 關鍵字轉 JSON
        candidate = re.sub(
            r"\b(None|True|False)\b",
            lambda m: {"None": "null", "True": "true", "False": "false"}[m.group()],
            candidate
        )
        
        # 移除尾逗號
        candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)
        
        # 解析 JSON
        try:
            result = json.loads(candidate)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON 解析失敗：{e}\n內容：{candidate[:500]}")
        
        # 確保回傳 list
        if isinstance(result, dict):
            return [result]
        return result
    
    def _wrap_multiple_objects(self, s: str) -> str:
        """若字串是多個頂層物件，包成陣列"""
        t = s.strip()
        if t.startswith('['):
            return s
        
        parts = []
        depth = 0
        in_str = False
        esc = False
        quote = ''
        start_idx = None
        
        for i, ch in enumerate(t):
            if in_str:
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == quote:
                    in_str = False
            else:
                if ch in ('"', "'"):
                    in_str = True
                    quote = ch
                elif ch == '{':
                    if depth == 0:
                        start_idx = i
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0 and start_idx is not None:
                        parts.append(t[start_idx:i+1])
                        start_idx = None
        
        if len(parts) >= 2:
            return '[' + ','.join(parts) + ']'
        return s
    
    def extract_from_pdf(
        self,
        pdf_filename: str,
        case_link: Optional[str] = None,
        use_local: bool = True
    ) -> List[Dict[str, Any]]:
        """
        從 PDF 萃取資料
        
        Args:
            pdf_filename: PDF 檔名 (例如: 2ta1032586t1cvn.pdf)
            case_link: CASE_LINK (可選)
            use_local: 是否使用本地檔案 (預設 True)
        
        Returns:
            被告資料列表
        """
        try:
            # 1. 載入 PDF
            if use_local:
                pdf_bytes = self.load_pdf_from_local(pdf_filename)
                doc_id = pdf_filename.replace('.pdf', '')
            else:
                doc_id = self.extract_doc_id_from_link(case_link)
                pdf_bytes = self.download_pdf_from_gcs(doc_id)
            
            # 2. 轉文字
            plain_text = self.pdf_to_text(pdf_bytes)
            
            if not plain_text.strip():
                raise ValueError("PDF 無法提取文字")
            
            # 3. LLM 萃取
            llm_response = self.call_llm(plain_text)
            
            # 4. 解析結果
            defendants = self.parse_llm_response(llm_response)
            
            # 5. 添加 metadata
            for defendant in defendants:
                # 統一使用完整 URL 格式，與 notebook 一致
                if case_link:
                    defendant['CASE_LINK'] = case_link
                else:
                    # 從本地檔名構建標準 URL 格式
                    defendant['CASE_LINK'] = f'https://congbobanan.toaan.gov.vn/{doc_id}/chi-tiet-ban-an'
                defendant['DOC_ID'] = doc_id
                defendant['MODEL'] = self.model_config.model_id
            
            return defendants
        
        except Exception as e:
            raise RuntimeError(f"萃取失敗 ({pdf_filename}): {str(e)}\n{traceback.format_exc()}")
    
    def batch_extract(
        self,
        pdf_files: List[str],
        output_jsonl: Optional[Path] = None,
        output_csv: Optional[Path] = None,
        progress_callback=None,
        max_runtime_minutes: Optional[int] = None,
        num_workers: int = 3
    ) -> pd.DataFrame:
        """
        批次萃取多個 PDF（支援斷點續跑、多線程並行）

        Args:
            pdf_files: PDF 檔案列表
            output_jsonl: 輸出 JSONL 路徑 (可選)
            output_csv: 輸出 CSV 路徑 (可選)
            progress_callback: 進度回調函數 (可選)
            max_runtime_minutes: 最大執行時間（分鐘）(可選)
            num_workers: 並行線程數（預設 3）

        Returns:
            萃取結果 DataFrame
        """
        start_time = time.time()

        # ========== 1. 讀取已處理的檔案（斷點續跑） ==========
        processed_files = set()
        if output_jsonl and output_jsonl.exists():
            with open(output_jsonl, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        obj = json.loads(line)
                        doc_id = obj.get('DOC_ID')
                        if doc_id:
                            processed_files.add(f"{doc_id}.pdf")
                    except Exception:
                        continue

        files_to_process = [f for f in pdf_files if f not in processed_files]

        if processed_files:
            print(f"📝 已有 {len(processed_files)} 個檔案已處理，將跳過")
            print(f"📝 剩餘 {len(files_to_process)} 個檔案待處理")

        if output_jsonl:
            output_jsonl.parent.mkdir(parents=True, exist_ok=True)
        if output_csv:
            output_csv.parent.mkdir(parents=True, exist_ok=True)

        total_count = len(processed_files) + len(files_to_process)

        # ========== 2. 線程安全工具 ==========
        jsonl_lock = threading.Lock()        # 保護 JSONL 寫入
        progress_lock = threading.Lock()     # 保護進度計數
        stop_event = threading.Event()       # 時間限制停止信號
        completed_count = [len(processed_files)]  # 用 list 讓 closure 可修改

        # ========== 3. 單一 PDF 處理函數（在各線程中執行） ==========
        def process_single(pdf_file: str):
            # 已超時則跳過
            if stop_event.is_set():
                return pdf_file, None, None

            # 檢查時間限制
            if max_runtime_minutes:
                elapsed_minutes = (time.time() - start_time) / 60
                if elapsed_minutes >= max_runtime_minutes:
                    stop_event.set()
                    print(f"\n⏰ 已達執行時間上限 ({max_runtime_minutes} 分鐘)")
                    return pdf_file, None, None

            try:
                defendants = self.extract_from_pdf(pdf_file, use_local=True)

                # 線程安全寫入 JSONL
                if output_jsonl and defendants:
                    with jsonl_lock:
                        with open(output_jsonl, 'a', encoding='utf-8') as f:
                            for defendant in defendants:
                                f.write(json.dumps(defendant, ensure_ascii=False) + '\n')

                # 線程安全更新進度
                with progress_lock:
                    completed_count[0] += 1
                    current = completed_count[0]

                if progress_callback:
                    progress_callback(current, total_count, pdf_file, "success")

                return pdf_file, defendants, None

            except Exception as e:
                error_msg = str(e)
                full_traceback = traceback.format_exc()
                error_obj = {
                    'pdf_file': pdf_file,
                    'error': error_msg,
                    'traceback': full_traceback,
                    'error_type': type(e).__name__
                }

                # 線程安全寫入錯誤記錄
                if output_jsonl:
                    error_file = output_jsonl.parent / f"{output_jsonl.stem}_errors.jsonl"
                    with jsonl_lock:
                        with open(error_file, 'a', encoding='utf-8') as f:
                            f.write(json.dumps(error_obj, ensure_ascii=False) + '\n')

                with progress_lock:
                    completed_count[0] += 1
                    current = completed_count[0]

                if progress_callback:
                    progress_callback(current, total_count, pdf_file, "error", full_traceback)

                return pdf_file, None, error_obj

        # ========== 4. 並行執行 ==========
        print(f"\n{'='*60}")
        print(f"🚀 並行萃取啟動：{num_workers} 個線程，共 {len(files_to_process)} 個檔案")
        print(f"{'='*60}\n")

        all_defendants = []

        with ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = {executor.submit(process_single, f): f for f in files_to_process}
            for future in as_completed(futures):
                _, defendants, _ = future.result()
                if defendants:
                    all_defendants.extend(defendants)

        # ========== 5. 全部完成後寫出 CSV ==========
        if output_csv and output_jsonl and output_jsonl.exists():
            all_data = []
            with open(output_jsonl, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        all_data.append(json.loads(line))
                    except Exception:
                        continue

            if all_data:
                df = pd.DataFrame(all_data)
                df.to_csv(output_csv, index=False, encoding='utf-8')
        else:
            df = pd.DataFrame(all_defendants)
            if output_csv and not df.empty:
                df.to_csv(output_csv, index=False, encoding='utf-8')

        return pd.DataFrame(all_defendants) if all_defendants else pd.DataFrame()
