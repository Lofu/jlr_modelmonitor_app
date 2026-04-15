#!/bin/bash
# 同時啟動前端和後端

# 取得 script 所在目錄的絕對路徑，確保路徑正確不受 cd 影響
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$SCRIPT_DIR/.venv/bin/python"

echo "🚀 啟動 LLM 萃取監控系統"
echo "================================"
echo ""

# 關閉已在執行的服務
echo "檢查並關閉舊有服務..."
BACKEND_PIDS=$(lsof -ti:8000 2>/dev/null)
if [ -n "$BACKEND_PIDS" ]; then
    echo "  關閉後端 (port 8000) PID: $BACKEND_PIDS"
    echo "$BACKEND_PIDS" | xargs kill -9 2>/dev/null
fi
FRONTEND_PIDS=$(lsof -ti:5173 2>/dev/null)
if [ -n "$FRONTEND_PIDS" ]; then
    echo "  關閉前端 (port 5173) PID: $FRONTEND_PIDS"
    echo "$FRONTEND_PIDS" | xargs kill -9 2>/dev/null
fi
# 關閉既有的同名 tmux session
tmux kill-session -t llm-monitor 2>/dev/null
echo ""

# 檢查是否安裝 tmux 或 screen
if command -v tmux &> /dev/null; then
    echo "使用 tmux 同時啟動前後端..."
    
    # 建立新的 tmux session
    tmux new-session -d -s llm-monitor
    
    # 分割視窗
    tmux split-window -h
    
    # 在左側啟動後端
    tmux send-keys -t 0 "cd '$SCRIPT_DIR/api' && '$PYTHON' -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload" C-m
    
    # 在右側啟動前端
    tmux send-keys -t 1 "cd '$SCRIPT_DIR/frontend' && npm run dev" C-m
    
    # 附加到 session
    tmux attach-session -t llm-monitor
    
elif command -v screen &> /dev/null; then
    echo "使用 screen 同時啟動前後端..."

    # 後端用子 shell 背景啟動（避免 cd 影響當前目錄）
    ( cd "$SCRIPT_DIR/api" && "$PYTHON" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload ) &
    BACKEND_PID=$!
    echo "後端已啟動 (PID: $BACKEND_PID)"

    # 前端前景啟動
    cd "$SCRIPT_DIR/frontend" && npm run dev

else
    echo "⚠️  建議安裝 tmux 以便同時查看前後端日誌：brew install tmux"
    echo ""
    echo "以背景模式啟動後端，前端在前景執行..."
    echo ""

    # 後端用子 shell 背景啟動（避免 cd 影響當前目錄）
    ( cd "$SCRIPT_DIR/api" && "$PYTHON" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload ) &
    BACKEND_PID=$!
    echo "後端已啟動 (PID: $BACKEND_PID)"

    # 前端前景啟動
    cd "$SCRIPT_DIR/frontend" && npm run dev
fi
