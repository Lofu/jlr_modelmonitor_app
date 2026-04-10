# 🚀 快速啟動指南

## 第一次使用

### 1. 安裝後端依賴
```bash
# 確保虛擬環境已啟動
source .venv/bin/activate

# 安裝依賴
pip install -r requirements.txt
pip install -r requirements-api.txt
```

### 2. 安裝前端依賴
```bash
cd frontend
npm install
cd ..
```

### 3. 設定 GCP 認證
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-key.json"
```

## 啟動應用

### 方式一：分別啟動（推薦）

**終端 1 - 後端:**
```bash
./start-backend.sh
```

**終端 2 - 前端:**
```bash
./start-frontend.sh
```

### 方式二：使用 tmux 同時啟動
```bash
brew install tmux  # 如果尚未安裝
./start-all.sh
```

## 訪問應用

- 🎨 前端: http://localhost:5173
- ⚡ 後端: http://localhost:8000
- 📚 API 文檔: http://localhost:8000/docs

## 功能頁面

1. **PDF 萃取** - 使用 LLM 模型萃取 PDF 資料
2. **準確度分析** - 比較多個模型的萃取準確度
3. **檔案管理** - 管理萃取結果檔案

---

**詳細說明請見 README-REACT.md**
