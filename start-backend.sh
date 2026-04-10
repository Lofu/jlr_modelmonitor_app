#!/bin/bash
# 啟動後端 FastAPI 服務

echo "🚀 啟動 FastAPI 後端服務..."
echo "================================"

# 設定專案根目錄
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 檢查虛擬環境
if [ ! -d ".venv" ]; then
    echo "❌ 找不到虛擬環境，請先執行 python -m venv .venv"
    exit 1
fi

# 使用完整路徑
PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
PIP_BIN="$PROJECT_DIR/.venv/bin/pip"

# 檢查依賴
echo "📦 檢查依賴套件..."
if [ -f "requirements.txt" ]; then
    $PIP_BIN install -q -r requirements.txt
fi
if [ -f "requirements-api.txt" ]; then
    $PIP_BIN install -q -r requirements-api.txt
fi

echo ""
echo "✅ 後端啟動於 http://localhost:8000"
echo "📚 API 文檔: http://localhost:8000/docs"
echo "================================"
echo ""

# 啟動 FastAPI
cd api
$PYTHON_BIN -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
