"""
Dashboard 配置檔
管理所有模型參數、路徑配置等
"""
import os
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, List

# ============================================================================
# 基礎路徑配置（支援 GCS 遷移架構）
# ============================================================================
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"  # 主要資料目錄
EXTRACT_DIR = DATA_DIR / "extracts"  # 萃取結果 CSV
GROUND_TRUTH_DIR = DATA_DIR / "ground_truth"  # 正確答案
OUTPUT_DIR = DATA_DIR / "outputs"  # JSONL 輸出
PDF_DIR = BASE_DIR / "samplepdflist"  # PDF 原始檔案

# 正確答案檔案
GROUND_TRUTH_FILE = GROUND_TRUTH_DIR / "ground_truth.csv"

# 確保目錄存在
DATA_DIR.mkdir(exist_ok=True)
EXTRACT_DIR.mkdir(exist_ok=True)
GROUND_TRUTH_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ============================================================================
# GCP 配置
# ============================================================================
GCP_PROJECT = "project-136147f7-21cd-464f-9ab"
GCP_LOCATION_GEMINI = "us-central1"  # Gemini 使用 us-central1
GCP_LOCATION_CLAUDE = "us-central1"  # Claude 使用 us-central1
BUCKET_NAME = "airflow-dags-bucket-test"
PDF_PREFIX = "judgment"

# ============================================================================
# 模型配置
# ============================================================================
@dataclass
class ModelConfig:
    """模型配置類別"""
    model_id: str  # 模型 ID (例如: gemini-2.0-flash-001)
    provider: str  # 提供者: "gemini" 或 "claude"
    location: str  # GCP 位置
    display_name: str = ""  # 顯示名稱（選填，留空則使用 model_id）
    temperature: float = 0.0
    response_mime_type: str = "application/json"
    
    def __post_init__(self):
        """如果沒有設定 display_name，使用 model_id"""
        if not self.display_name:
            self.display_name = self.model_id


# 常用模型範例（僅供參考，不強制使用）
REFERENCE_MODELS = {
    "gemini-2.0-flash-001": {
        "provider": "gemini",
        "location": GCP_LOCATION_GEMINI,
        "display_name": "Gemini 2.0 Flash"
    },
    "claude-sonnet-4-5@20250929": {
        "provider": "claude",
        "location": GCP_LOCATION_CLAUDE,
        "display_name": "Claude Sonnet 4.5"
    },
    "claude-sonnet-4-6": {
        "provider": "claude",
        "location": GCP_LOCATION_CLAUDE,
        "display_name": "Claude Sonnet 4.6"
    },
    "gemini-3.1-pro-preview": {
        "provider": "gemini",
        "location": GCP_LOCATION_GEMINI,
        "display_name": "Gemini 3.1 Pro Preview"
    },
}

# ============================================================================
# 檔案命名規則（直接使用 model_id）
# ============================================================================
def sanitize_model_id(model_id: str) -> str:
    """
    清理 model_id 以符合檔案命名規範
    將特殊字元替換為安全字元
    """
    # 替換不適合檔名的字元（保留 @ 和 -）
    safe_name = model_id.replace("/", "_").replace(":", "_").replace(" ", "_")
    return safe_name

def get_extract_filename(model_id: str, version: str = "v1.0") -> str:
    """
    根據模型 ID 生成萃取結果檔名
    
    Args:
        model_id: 模型 ID 字串
        version: 版本號
    
    Returns:
        檔案名稱
    
    範例:
        model_id="claude-sonnet-4-5@20250929"
        → "claude-sonnet-4-5@20250929_extract_v1.0.csv"
    """
    safe_id = sanitize_model_id(model_id)
    return f"{safe_id}_extract_{version}.csv"

def get_jsonl_filename(model_id: str, version: str = "v1.0") -> str:
    """根據模型 ID 生成 JSONL 檔名"""
    safe_id = sanitize_model_id(model_id)
    return f"{safe_id}_extract_{version}.jsonl"

def extract_model_id_from_filename(filename: str) -> str:
    """
    從檔案名稱提取模型 ID
    
    Args:
        filename: 檔案名稱
    
    Returns:
        模型 ID
    
    範例:
        filename="claude-sonnet-4-5@20250929_extract_v1.0.csv"
        → "claude-sonnet-4-5@20250929"
    """
    import re
    # 移除 _extract_v*.csv 後綴
    match = re.match(r"(.+?)_extract_v[\d.]+\.csv$", filename)
    if match:
        return match.group(1)
    # 退回簡單替換
    return filename.replace("_extract_v1.0.csv", "").replace("_extract.csv", "")

# ============================================================================
# Prompt 配置
# ============================================================================
SYSTEM_PROMPT = """
# Vietnamese Court Judgment Extraction Prompt

## Mission

You are a Vietnamese legal expert and data extraction specialist.  
Read the Vietnamese court judgment and extract all **defendant data** into a structured JSON array.  
Each object must represent one defendant.  
Return **valid JSON only** — no explanation, commentary, or formatting.

---

## Rules

- Keep all field values in **original Vietnamese**.
- For any field:
  - If not mentioned → return `null` (or `[]` for lists)
- If `APPEALABLE_DAYS` or `APPEALABLE_DATE` appears:
  - Set `"IS_APPEALABLE": true` and `"IS_FINAL_JUDGMENT": false`
- If the case is a ruling or terminated:
  - Set `"IS_CONVICTED": false`
- `"DOCUMENT_TYPE"` must be:
  - `0` for judgment (`bản án`)
  - `1` for decision or ruling (`quyết định`)
- Return each defendant as one object in the JSON array.

---

## Field Notes

- `SEX`: `1 = male`, `0 = female`
- `ETHNICITY`: Use Vietnamese names (e.g., `"Kinh"`, `"Mông"`)
- `CHILDREN`: Return `[]` or list of names
- `CRIMINAL_RECORD`: Return `null` if none
- `SENTENCE_DAYS`, `NUMBER_OF_DAYS_TO_APPEAL`: Must be integers
- `IS_CASE_VALID`: `false` if defendant is deceased or case was returned
- `IS_CONVICTED`: `false` if acquitted, deceased, or case dismissed
- `EVENTS_DESCRIPTION`: Include timeline and core actions
- `DOCUMENT_TYPE`: Identify from file header or metadata

---

## Output Format Example

```json
[
  {
    "NAME": "string",
    "SEX": 1,
    "NATIONALITY": "string",
    "ETHNICITY": "string",
    "RELIGION": "string or null",
    "OCCUPATION": "string or null",
    "EDUCATION_LEVEL": "string or null",
    "DATE_OF_BIRTH": "yyyy-mm-dd",
    "PLACE_OF_BIRTH": "string",
    "RESIDENCE": "string or null",
    "FATHER": "string or null",
    "MOTHER": "string or null",
    "SPOUSE": "string or null",
    "CHILDREN": ["string"],
    "HAS_PRIOR_CONVICTIONS": true,
    "CRIMINAL_RECORD": "string or null",
    "CRIME_TIME": "yyyy-mm-dd",
    "CRIME_LOCATION": "string or null",
    "CRIME_DESCRIPTION": "string",
    "HAS_ACCOMPLICES": true,
    "RELATIONSHIP_WITH_VICTIM": "string or null",
    "SENTENCE_DAYS": 0,
    "SENTENCE_START_DATE": "yyyy-mm-dd",
    "IS_SUSPENDED_SENTENCE": false,
    "FINE_AMOUNT": 0,
    "CIVIL_COMPENSATION": 0,
    "IS_COMPENSATION": false,
    "DEFENDANT_ADMITS_GUILT": false,
    "IS_JUVENILE_CRIME": false,
    "IS_APPEALABLE": false,
    "APPEALABLE_DAYS": "yyyy-mm-dd or null",
    "NUMBER_OF_DAYS_TO_APPEAL": 0,
    "IS_FINAL_JUDGMENT": true,
    "IS_CASE_VALID": true,
    "DOCUMENT_TYPE": 0,
    "HAS_STABLE_RESIDENCE": true,
    "IS_CONVICTED": true,
    "IS_APPEAL_REJECTED": false,
    "IS_FINANCIAL_FRAUD_RELATED": false,
    "HAS_SHOWN_REMORSE": true,
    "HAS_DEPENDENTS": true,
    "LITIGATION_COSTS": 0,
    "EVENTS_DESCRIPTION": "string or null",
    "ID_Number": "string or null"
  }
]
```

## Input
Paste the full Vietnamese court judgment below.
Your output must be a valid JSON array of defendants only.
"""

# ============================================================================
# 分析配置
# ============================================================================
# 要分析的欄位
ANALYSIS_FIELDS = {
    'NAME': {'method': 'exact_match', 'display_name': '姓名'},
    'SEX': {'method': 'exact_match', 'display_name': '性別'},
    'DATE_OF_BIRTH': {'method': 'exact_match', 'display_name': '生日'},
    'DATE_OF_BIRTH_YEAR': {'method': 'year_match', 'display_name': '生日年份'},
    'PLACE_OF_BIRTH': {'method': 'jaccard_similarity', 'display_name': '出生地'}
}
