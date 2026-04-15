# 法院判例 LLM 模型評估系統

用於評估多個 LLM 模型（Gemini、Claude）在越南法院判決 PDF 結構化萃取任務上的準確度，並透過互動式 Dashboard 進行視覺化比較分析。

---

## 技術架構

```
ModelChange_Monitor_react/
├── api/
│   └── main.py                  # FastAPI 後端（port 8000）
├── dashboard/
│   ├── config.py                # 模型配置、路徑、Prompt、分析欄位
│   ├── extractor.py             # PDF 萃取模組（呼叫 Vertex AI）
│   ├── analyzer.py              # 準確度分析模組
│   └── bq_client.py             # BigQuery 讀寫模組
├── frontend/
│   └── src/
│       ├── App.tsx              # 主應用（Ant Design Layout + 路由）
│       ├── pages/
│       │   ├── ExtractPage.tsx      # PDF 萃取
│       │   ├── AnalyzePage.tsx      # 準確度分析
│       │   ├── FilesPage.tsx        # 萃取結果檔案管理
│       │   └── DataManagePage.tsx   # BigQuery 執行紀錄管理
│       └── services/
│           └── api.ts               # 前端 API 呼叫封裝
├── data/
│   ├── extracts/                # 萃取結果 CSV
│   ├── ground_truth/            # 正確答案 CSV（ground_truth.csv）
│   └── outputs/                 # 萃取原始 JSONL 輸出
├── samplepdflist/               # 越南法院判例 PDF（98 篇）
├── start-all.sh                 # 使用 tmux 同時啟動前後端
├── requirements.txt             # Python 依賴（Streamlit 舊版用，保留）
└── requirements-api.txt         # FastAPI 後端依賴
```

### 前端
- **React 18 + TypeScript**，使用 Vite 建置
- **Ant Design 5** 元件庫
- **Recharts** 圖表呈現

### 後端
- **FastAPI**，提供 RESTful API
- **Vertex AI** 呼叫 Gemini / Claude 模型進行 PDF 萃取
- **BigQuery** 儲存執行紀錄與萃取結果（dataset: `jlr_model_monitor`）

### BigQuery 資料表
| 資料表 | 說明 |
|--------|------|
| `extraction_runs` | 每次萃取任務的執行紀錄（模型、Prompt、時間等） |
| `extractions` | 各 PDF 的萃取結果（與 run_id 關聯） |
| `ground_truth` | 正確答案資料 |

---

## 功能頁面

### 1. PDF 萃取（ExtractPage）
- 設定模型 ID、provider（gemini / claude）、GCP location
- 自訂 Prompt（可查看目前使用的完整 Prompt）
- 批次萃取 `samplepdflist/` 中的 PDF，即時顯示進度
- 結果同時儲存為 CSV（`data/extracts/`）、JSONL（`data/outputs/`）並寫入 BigQuery

### 2. 準確度分析（AnalyzePage）
- 從已完成的執行紀錄選取分析對象（支援多模型、同模型不同 Prompt）
- 圖表一：各模型萃取被告人數（含正確人數 224 基準線）
- 圖表二：指定欄位的完全一致率比較
- 圖表三：各欄位平均相似度排名
- 詳細準確度數據表（群組標題：模型 → 完全一致率 / 平均相似度 / 成功總數）
- Ground Truth 資料預覽

**評估欄位與方法：**
| 欄位 | 方法 |
|------|------|
| 姓名（NAME） | 精確匹配 |
| 性別（SEX） | 精確匹配 |
| 生日（DATE_OF_BIRTH） | 精確匹配 |
| 生日年份（DATE_OF_BIRTH_YEAR） | 年份匹配 |
| 出生地（PLACE_OF_BIRTH） | Jaccard 相似度（3-gram） |

### 3. 檔案管理（FilesPage）
- 查看 `data/extracts/` 中的萃取 CSV
- 下載、匯入至 BigQuery、刪除

### 4. 執行紀錄管理（DataManagePage）
- 查看 BigQuery 中的執行紀錄（`extraction_runs`）
- 刪除指定執行紀錄（同步刪除 `extractions` 中的對應資料）

---

## 環境需求

- Python 3.11+
- Node.js 18+
- GCP 專案（已啟用 Vertex AI API、BigQuery API）
- Google ADC（Application Default Credentials）

---

## 安裝與啟動

### 1. 安裝依賴

```bash
# 後端
source .venv/bin/activate
pip install -r requirements-api.txt

# 前端
cd frontend
npm install
cd ..
```

### 2. GCP 認證

```bash
gcloud auth application-default login
```

### 3. 啟動應用

```bash
./start-all.sh
```

> 使用 tmux 同時啟動前後端。若未安裝 tmux：`brew install tmux`

### 4. 訪問

| 服務 | 網址 |
|------|------|
| 前端 Dashboard | http://localhost:5173 |
| 後端 API | http://localhost:8000 |
| API 文件（Swagger） | http://localhost:8000/docs |

---

## 新增模型

在 [dashboard/config.py](dashboard/config.py) 的 `REFERENCE_MODELS` 中新增條目（僅供參考）：

```python
"gemini-2.5-flash": {
    "provider": "gemini",
    "location": "us-central1",
    "display_name": "Gemini 2.5 Flash"
}
```

模型 ID 可在萃取頁面的表單中直接輸入，不限於 `REFERENCE_MODELS` 清單。

---

## 常見問題

**Q: 分析時出現 NA 值或圖表缺失**
A: 確認執行萃取時使用的模型 ID 與執行紀錄一致。同一模型使用不同 Prompt 時，系統會自動以 prompt hash 區分，兩者可獨立或合併分析。

**Q: 無法連接 Vertex AI**
A: 重新執行 `gcloud auth application-default login` 更新 ADC 憑證。

**Q: BigQuery 寫入失敗**
A: 確認 GCP Project（`config.py` 中的 `GCP_PROJECT`）有 BigQuery 寫入權限，且 dataset `jlr_model_monitor` 已建立。

---

## 版本歷史

### v2.0.0 (2026-04-15)
- 全面重構為 React + FastAPI 架構（取代原 Streamlit 版本）
- 整合 BigQuery 儲存執行紀錄
- 支援同模型多 Prompt 獨立分析
- 準確度分析頁面大幅優化（群組表頭、一致配色、多圖表）
- 操作說明頁面（FilesPage、DataManagePage）按鈕 icon-only 優化

### v1.0.0 (2026-04-08)
- 初始 Streamlit 版本
- 支援 4 種 LLM 模型 PDF 萃取
- 基礎準確度分析與視覺化

---

**CDC 資料科學團隊 · 內部使用專案**
