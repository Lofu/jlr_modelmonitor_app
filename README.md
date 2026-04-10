# 📊 LLM 萃取準確度監控 Dashboard

一個用於監控多個 LLM 模型（Gemini、Claude）在越南法院判決 PDF 文件結構化萃取準確度的互動式 Dashboard。

## ✨ 功能特色

### 🎯 核心功能

1. **自動化 PDF 萃取**
   - 支援多種 LLM 模型（Gemini 2.0 Flash、Gemini 1.5 Pro、Claude Sonnet 4.5、Gemini 3.1 Pro Preview）
   - 批次處理本地 PDF 檔案
   - 即時顯示萃取進度
   - 自動儲存為 CSV 和 JSONL 格式

2. **準確度分析**
   - 與基準資料（NotebookLM）比對
   - 計算多種相似度指標（精確匹配、年份匹配、Jaccard 相似度）
   - 分析欄位：姓名、性別、生日、生日年份、出生地

3. **視覺化呈現**
   - 互動式圖表（完全一致率比較、模型匹配情況）
   - 即時統計摘要
   - 可下載分析結果

4. **檔案管理**
   - 查看已萃取的結果
   - 刪除舊檔案
   - 檢視系統狀態

### 🏗️ 技術架構

```
專案結構：
ModelChange_Monitor/
├── app.py                              # Streamlit 主程式
├── dashboard/                          # 核心模組
│   ├── __init__.py
│   ├── config.py                       # 配置檔（模型、路徑、Prompt）
│   ├── extractor.py                    # PDF 萃取模組
│   └── analyzer.py                     # 準確度分析模組
├── samplepdflist/                      # PDF 原始檔案資料夾
├── outputs/                            # JSONL 輸出資料夾
├── 法院判例GroudTH - 工作表1.csv       # NotebookLM 基準資料
├── *_extract_v1.0.csv                  # 模型萃取結果
├── requirements.txt                    # Python 相依套件
└── README.md                           # 本檔案
```

### 💡 為什麼需要後端？

雖然不需要資料庫，但仍需要輕量級後端（Streamlit），原因如下：

1. **Vertex AI API 呼叫**：需要 GCP 憑證，不能暴露在瀏覽器前端
2. **PDF 處理**：pypdf 是 Python 套件，瀏覽器無法執行
3. **檔案系統操作**：讀寫 CSV/JSONL 檔案
4. **大量計算**：相似度分析適合在伺服器端進行

### 🗄️ 資料儲存策略（無資料庫）

- **基準資料**：`法院判例GroudTH - 工作表1.csv`
- **萃取結果**：`{模型名稱}_extract_v1.0.csv`
- **原始輸出**：`outputs/{模型名稱}_extract_v1.0.jsonl`
- **檔案命名標準化**：由 `config.py` 統一管理

---

## 🚀 快速開始

### 1. 環境需求

- Python 3.9+
- GCP 專案（已啟用 Vertex AI API）
- GCP 認證憑證

### 2. 安裝相依套件

```bash
cd ModelChange_Monitor
pip install -r requirements.txt
```

### 3. GCP 認證設定

#### 方法 A：使用 Service Account Key（推薦）

```bash
# 下載 Service Account JSON 金鑰檔
# 設定環境變數
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-service-account-key.json"
```

#### 方法 B：使用 gcloud CLI

```bash
gcloud auth application-default login
gcloud config set project cdcda-lab-377808
```

### 4. 準備資料

確保以下檔案存在：

```
samplepdflist/                # PDF 檔案（例如：2ta1032586t1cvn.pdf）
法院判例GroudTH - 工作表1.csv  # NotebookLM 基準資料
```

### 5. 啟動 Dashboard

```bash
streamlit run app.py
```

瀏覽器會自動開啟 `http://localhost:8501`

---

## 📖 使用說明

### 步驟 1：選擇模型

在左側邊欄選擇要使用的 LLM 模型（可多選）：

- ✅ Gemini 2.0 Flash
- ✅ Gemini 1.5 Pro
- ✅ Claude Sonnet 4.5
- ✅ Gemini 3.1 Pro Preview

### 步驟 2：PDF 萃取

1. 切換到「**📄 PDF 萃取**」頁面
2. 檢查 PDF 檔案列表
3. 查看已存在的萃取結果（如果有）
4. 點擊「**🚀 開始萃取**」按鈕
5. 等待萃取完成（會顯示即時進度）

⚠️ **注意**：萃取會覆蓋現有結果

### 步驟 3：準確度分析

1. 切換到「**📈 準確度分析**」頁面
2. 確認已載入基準資料
3. 點擊「**🔍 開始分析**」按鈕
4. 查看分析結果：
   - 📋 準確度摘要表
   - 📊 完全一致率比較圖
   - 📈 模型匹配情況圖
5. 下載分析結果 CSV

### 步驟 4：檔案管理

1. 切換到「**📦 檔案管理**」頁面
2. 查看所有已萃取的結果
3. 刪除不需要的檔案（點擊 🗑️ 按鈕）

---

## 🔧 配置說明

### 修改模型配置

編輯 [dashboard/config.py](dashboard/config.py)：

```python
AVAILABLE_MODELS = {
    "gemini-2.0-flash-001": ModelConfig(
        model_id="gemini-2.0-flash-001",
        display_name="Gemini 2.0 Flash",
        provider="gemini",
        location="global",
        output_prefix="Gemini_2_0_flash"
    ),
    # 添加新模型...
}
```

### 修改 Prompt

編輯 [dashboard/config.py](dashboard/config.py) 中的 `SYSTEM_PROMPT` 變數。

### 修改分析欄位

編輯 [dashboard/config.py](dashboard/config.py)：

```python
ANALYSIS_FIELDS = {
    'NAME': {'method': 'exact_match', 'display_name': '姓名'},
    'SEX': {'method': 'exact_match', 'display_name': '性別'},
    # 添加新欄位...
}
```

---

## 📊 準確度計算方法

### 1. 精確匹配 (Exact Match)

用於：**NAME**、**SEX**、**DATE_OF_BIRTH**

- 完全相同 → 1.0
- 不同 → 0.0
- 雙方都是空值 → 1.0

### 2. 年份匹配 (Year Match)

用於：**DATE_OF_BIRTH_YEAR**

特殊規則：
- `1992` 與 `1992-01-01` → 視為相同 ✅
- `1992` 與 `1992-05-15` → 視為不同 ❌
- 只比對年份，忽略月日

### 3. Jaccard 相似度 (3-gram)

用於：**PLACE_OF_BIRTH**

- 使用 3-gram 字元切割
- 計算交集 / 聯集
- 範圍：0.0（完全不同）～ 1.0（完全相同）
- 「未提及」視為空值，不納入計算

---

## 🎨 範例輸出

### 萃取結果 CSV

| CASE_LINK | NAME | SEX | DATE_OF_BIRTH | PLACE_OF_BIRTH | ... |
|-----------|------|-----|---------------|----------------|-----|
| https://... | Nguyễn Văn A | 1 | 1992-01-01 | Hà Nội | ... |

### 準確度摘要表

| 模型 | 欄位 | 平均相似度 | 完全一致率 | 完全一致數 | 總筆數 |
|------|------|-----------|-----------|-----------|--------|
| Gemini_2_0_flash | NAME | 0.906 | 0.906 | 203 | 224 |
| Claude_Sonnet_4_5 | SEX | 0.987 | 0.987 | 221 | 224 |

---

## ⚠️ 注意事項

### 成本控制

- Vertex AI API 會產生費用
- 每個 PDF 約 5-10 秒（視模型而定）
- 建議先用少量 PDF 測試

### 錯誤處理

- PDF 解析失敗會記錄到 `*_errors.jsonl`
- 檢查 `outputs/` 資料夾中的錯誤記錄

### 檔案覆蓋

- **按下萃取按鈕會覆蓋現有結果**
- 建議重要結果先備份或改檔名

---

## 🐛 常見問題

### Q1: 無法連接到 Vertex AI

**A**: 檢查 GCP 認證：

```bash
gcloud auth application-default login
gcloud config set project cdcda-lab-377808
```

### Q2: 找不到 PDF 檔案

**A**: 確認 PDF 檔案在 `samplepdflist/` 資料夾中

### Q3: 分析時顯示「尚未萃取」

**A**: 請先在「PDF 萃取」頁面執行萃取

### Q4: 中文字型無法顯示

**A**: 安裝字型：

```bash
# macOS
brew install font-microsoft-yahei

# Ubuntu
sudo apt-get install fonts-wqy-zenhei
```

---

## 🔄 未來優化方向

- [ ] 支援從 GCS 直接下載 PDF
- [ ] 新增更多分析指標（F1 Score、Precision、Recall）
- [ ] 支援匯出 PDF 報告
- [ ] 新增模型效能比較（速度、成本）
- [ ] 支援自訂 Prompt 測試

---

## 📝 版本歷史

### v1.0.0 (2026-04-08)

- ✅ 初始版本
- ✅ 支援 4 種 LLM 模型
- ✅ PDF 批次萃取功能
- ✅ 準確度分析與視覺化
- ✅ 檔案管理功能

---

## 👨‍💻 開發者

**CDC 資料科學團隊**

---

## 📄 授權

內部使用專案

---

## 🙏 致謝

- Google Vertex AI
- Streamlit
- pypdf
- pandas & matplotlib

---

**Happy Monitoring! 📊✨**
