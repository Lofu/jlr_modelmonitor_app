"""
BigQuery 客戶端模組
負責資料表建立、歷史資料匯入、寫入與查詢
"""
import hashlib
import io
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional
import pandas as pd

from google.cloud import bigquery
from google.cloud.exceptions import NotFound

from .config import GCP_PROJECT

# ============================================================================
# BQ 常數
# ============================================================================
BQ_DATASET = "jlr_model_monitor"
BQ_TABLE_RUNS = "extraction_runs"
BQ_TABLE_EXTRACTIONS = "extractions"
BQ_TABLE_GROUND_TRUTH = "ground_truth"

# ============================================================================
# Schema 定義
# ============================================================================
RUNS_SCHEMA = [
    bigquery.SchemaField("run_id",         "STRING",    mode="REQUIRED"),
    bigquery.SchemaField("model_id",        "STRING"),
    bigquery.SchemaField("provider",        "STRING"),
    bigquery.SchemaField("location",        "STRING"),
    bigquery.SchemaField("gcp_project",     "STRING"),
    bigquery.SchemaField("prompt_hash",     "STRING"),
    bigquery.SchemaField("prompt_preview",  "STRING"),
    bigquery.SchemaField("prompt_full",     "STRING"),
    bigquery.SchemaField("started_at",      "TIMESTAMP"),
    bigquery.SchemaField("completed_at",    "TIMESTAMP"),
    bigquery.SchemaField("total_files",     "INT64"),
    bigquery.SchemaField("success_count",   "INT64"),
    bigquery.SchemaField("error_count",     "INT64"),
]

EXTRACTIONS_SCHEMA = [
    bigquery.SchemaField("run_id",          "STRING"),
    bigquery.SchemaField("model_id",        "STRING"),
    bigquery.SchemaField("prompt_hash",     "STRING"),
    bigquery.SchemaField("extracted_at",    "TIMESTAMP"),
    bigquery.SchemaField("doc_id",          "STRING"),
    bigquery.SchemaField("file_name",       "STRING"),
    bigquery.SchemaField("case_link",       "STRING"),
    bigquery.SchemaField("NAME",            "STRING"),
    bigquery.SchemaField("SEX",             "STRING"),
    bigquery.SchemaField("DATE_OF_BIRTH",   "STRING"),
    bigquery.SchemaField("PLACE_OF_BIRTH",  "STRING"),
    bigquery.SchemaField("raw_json",        "STRING"),
]

GROUND_TRUTH_SCHEMA = [
    bigquery.SchemaField("file_name",                   "STRING"),
    bigquery.SchemaField("NAME",                        "STRING"),
    bigquery.SchemaField("notebookLM_SEX",              "STRING"),
    bigquery.SchemaField("notebookLM_DATE_OF_BIRTH",    "STRING"),
    bigquery.SchemaField("notebookLM_PLACE_OF_BIRTH",   "STRING"),
]

_SCHEMAS = {
    BQ_TABLE_RUNS:         RUNS_SCHEMA,
    BQ_TABLE_EXTRACTIONS:  EXTRACTIONS_SCHEMA,
    BQ_TABLE_GROUND_TRUTH: GROUND_TRUTH_SCHEMA,
}


class BQClient:
    """BigQuery 操作客戶端（使用 load job，資料立即可查詢）"""

    def __init__(self, gcp_project: str = None):
        self.project = gcp_project or GCP_PROJECT
        self.client = bigquery.Client(project=self.project)
        self.dataset_ref = f"{self.project}.{BQ_DATASET}"
        self._ensure_dataset()
        self._ensure_tables()

    # ------------------------------------------------------------------ #
    #  初始化
    # ------------------------------------------------------------------ #
    def _ensure_dataset(self):
        try:
            self.client.get_dataset(self.dataset_ref)
        except NotFound:
            ds = bigquery.Dataset(self.dataset_ref)
            ds.location = "US"
            self.client.create_dataset(ds)
            print(f"✅ 建立 Dataset: {BQ_DATASET}")

    def _ensure_tables(self):
        for name, schema in _SCHEMAS.items():
            table_id = f"{self.dataset_ref}.{name}"
            try:
                self.client.get_table(table_id)
            except NotFound:
                self.client.create_table(bigquery.Table(table_id, schema=schema))
                print(f"✅ 建立 Table: {name}")

    # ------------------------------------------------------------------ #
    #  通用寫入（load job，WRITE_APPEND）
    # ------------------------------------------------------------------ #
    def _append_rows(self, table_name: str, rows: List[dict], schema=None):
        """以 load job 方式 append 寫入（無 streaming delay，立即可查詢）"""
        if not rows:
            return
        table_id = f"{self.dataset_ref}.{table_name}"
        job_config = bigquery.LoadJobConfig(
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema or _SCHEMAS.get(table_name),
        )
        ndjson = "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows)
        job = self.client.load_table_from_file(
            io.StringIO(ndjson), table_id, job_config=job_config
        )
        job.result()  # 等待完成

    def _overwrite_rows(self, table_name: str, rows: List[dict], schema=None):
        """以 load job 方式覆寫（WRITE_TRUNCATE）"""
        if not rows:
            return
        table_id = f"{self.dataset_ref}.{table_name}"
        job_config = bigquery.LoadJobConfig(
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema=schema or _SCHEMAS.get(table_name),
        )
        ndjson = "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows)
        job = self.client.load_table_from_file(
            io.StringIO(ndjson), table_id, job_config=job_config
        )
        job.result()

    # ------------------------------------------------------------------ #
    #  extraction_runs 操作
    # ------------------------------------------------------------------ #
    @staticmethod
    def make_run_id() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def hash_prompt(prompt: str) -> str:
        return hashlib.sha256(prompt.encode()).hexdigest()[:12]

    def save_run(
        self,
        run_id: str,
        model_id: str,
        provider: str,
        location: str,
        gcp_project: str,
        prompt: str,
        started_at: datetime,
        completed_at: datetime,
        total_files: int,
        success_count: int,
        error_count: int,
    ):
        """儲存一筆萃取執行紀錄（在萃取完成後呼叫）"""
        row = {
            "run_id":         run_id,
            "model_id":       model_id,
            "provider":       provider,
            "location":       location,
            "gcp_project":    gcp_project,
            "prompt_hash":    self.hash_prompt(prompt),
            "prompt_preview": prompt[:300],
            "prompt_full":    prompt,
            "started_at":     started_at.isoformat(),
            "completed_at":   completed_at.isoformat(),
            "total_files":    total_files,
            "success_count":  success_count,
            "error_count":    error_count,
        }
        self._append_rows(BQ_TABLE_RUNS, [row])

    def list_runs(self) -> List[dict]:
        """列出所有執行紀錄（最新在前）"""
        query = f"""
        SELECT run_id, model_id, provider, prompt_hash, prompt_preview,
               FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', started_at)   AS started_at,
               FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', completed_at) AS completed_at,
               total_files, success_count, error_count
        FROM `{self.dataset_ref}.{BQ_TABLE_RUNS}`
        ORDER BY started_at DESC
        """
        return [dict(row) for row in self.client.query(query).result()]

    # ------------------------------------------------------------------ #
    #  extractions 操作
    # ------------------------------------------------------------------ #
    def save_extractions(
        self,
        run_id: str,
        model_id: str,
        prompt: str,
        defendants: List[dict],
        extracted_at: datetime,
    ):
        """批次寫入萃取結果（append 模式）"""
        if not defendants:
            return
        prompt_hash = self.hash_prompt(prompt)
        ts = extracted_at.isoformat()
        rows = []
        for d in defendants:
            doc_id = str(d.get("DOC_ID", ""))
            rows.append({
                "run_id":        run_id,
                "model_id":      model_id,
                "prompt_hash":   prompt_hash,
                "extracted_at":  ts,
                "doc_id":        doc_id,
                "file_name":     f"{doc_id}.pdf" if doc_id else None,
                "case_link":     str(d.get("CASE_LINK", "") or ""),
                "NAME":          str(d.get("NAME", "") or "") or None,
                "SEX":           str(d.get("SEX", "") or "") or None,
                "DATE_OF_BIRTH": str(d.get("DATE_OF_BIRTH", "") or "") or None,
                "PLACE_OF_BIRTH":str(d.get("PLACE_OF_BIRTH", "") or "") or None,
                "raw_json":      json.dumps(d, ensure_ascii=False),
            })
        self._append_rows(BQ_TABLE_EXTRACTIONS, rows)

    def get_extractions_by_runs(self, run_ids: List[str]) -> pd.DataFrame:
        """查詢指定 run_id 的萃取結果（含 model_id）"""
        if not run_ids:
            return pd.DataFrame()
        ids_str = ", ".join(f"'{r}'" for r in run_ids)
        query = f"""
        SELECT run_id, model_id, prompt_hash, doc_id, file_name, case_link,
               NAME, SEX, DATE_OF_BIRTH, PLACE_OF_BIRTH
        FROM `{self.dataset_ref}.{BQ_TABLE_EXTRACTIONS}`
        WHERE run_id IN ({ids_str})
        """
        return self.client.query(query).to_dataframe()

    # ------------------------------------------------------------------ #
    #  ground_truth 操作
    # ------------------------------------------------------------------ #
    def upload_ground_truth(self, csv_path: Path):
        """上傳 ground truth CSV → BQ（全量覆寫）"""
        df = pd.read_csv(csv_path)

        # 支援中文或英文欄位名
        rename = {}
        if "檔案名稱" in df.columns:
            rename = {
                "檔案名稱":   "file_name",
                "被告人姓名": "NAME",
                "被告人性別": "notebookLM_SEX",
                "被告人生日": "notebookLM_DATE_OF_BIRTH",
                "被告人出生地":"notebookLM_PLACE_OF_BIRTH",
            }
            df = df.rename(columns=rename)

        required = ["file_name", "NAME", "notebookLM_SEX",
                    "notebookLM_DATE_OF_BIRTH", "notebookLM_PLACE_OF_BIRTH"]
        for col in required:
            if col not in df.columns:
                df[col] = None

        rows = []
        for _, row in df[required].iterrows():
            rows.append({c: (str(row[c]) if pd.notna(row[c]) else None) for c in required})

        self._overwrite_rows(BQ_TABLE_GROUND_TRUTH, rows)
        print(f"✅ ground_truth 上傳完成：{len(rows)} 筆")
        return len(rows)

    def get_ground_truth(self) -> pd.DataFrame:
        """查詢 ground truth"""
        query = f"SELECT * FROM `{self.dataset_ref}.{BQ_TABLE_GROUND_TRUTH}`"
        return self.client.query(query).to_dataframe()

    def ground_truth_count(self) -> int:
        query = f"SELECT COUNT(*) AS cnt FROM `{self.dataset_ref}.{BQ_TABLE_GROUND_TRUTH}`"
        return list(self.client.query(query).result())[0]["cnt"]

    # ------------------------------------------------------------------ #
    #  歷史 JSONL 匯入
    # ------------------------------------------------------------------ #
    def import_jsonl(
        self,
        jsonl_path: Path,
        model_id: str,
        provider: str,
        location: str,
        prompt: str,
        gcp_project: str = None,
    ) -> str:
        """將現有 JSONL 檔案一次性匯入 BQ，回傳 run_id"""
        if not jsonl_path.exists():
            raise FileNotFoundError(f"找不到檔案：{jsonl_path}")

        defendants = []
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    defendants.append(json.loads(line))
                except Exception:
                    continue

        run_id = self.make_run_id()
        now = datetime.now(timezone.utc)

        self.save_run(
            run_id=run_id, model_id=model_id, provider=provider,
            location=location, gcp_project=gcp_project or self.project,
            prompt=prompt, started_at=now, completed_at=now,
            total_files=len(defendants), success_count=len(defendants), error_count=0,
        )
        self.save_extractions(run_id, model_id, prompt, defendants, now)

        print(f"✅ 匯入 {jsonl_path.name}：{len(defendants)} 筆 → run_id={run_id}")
        return run_id

    # ------------------------------------------------------------------ #
    #  BQ 狀態
    # ------------------------------------------------------------------ #
    def status(self) -> dict:
        """回傳 BQ 連線與各表格狀態"""
        tables = {}
        for name in [BQ_TABLE_RUNS, BQ_TABLE_EXTRACTIONS, BQ_TABLE_GROUND_TRUTH]:
            try:
                t = self.client.get_table(f"{self.dataset_ref}.{name}")
                tables[name] = {"exists": True, "rows": t.num_rows}
            except NotFound:
                tables[name] = {"exists": False, "rows": 0}
        return {
            "dataset": BQ_DATASET,
            "project": self.project,
            "tables": tables,
        }
