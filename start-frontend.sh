#!/bin/bash
# 啟動前端 React 開發服務器

echo "🎨 啟動 React 前端服務..."
echo "================================"

# 進入前端目錄
cd frontend

# 檢查 node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 安裝前端依賴..."
    npm install
fi

echo ""
echo "✅ 前端啟動於 http://localhost:5173"
echo "================================"
echo ""

# 啟動開發服務器
npm run dev
