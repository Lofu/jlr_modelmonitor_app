#!/bin/bash
# 同時啟動前端和後端

echo "🚀 啟動 LLM 萃取監控系統"
echo "================================"
echo ""

# 檢查是否安裝 tmux 或 screen
if command -v tmux &> /dev/null; then
    echo "使用 tmux 同時啟動前後端..."
    
    # 建立新的 tmux session
    tmux new-session -d -s llm-monitor
    
    # 分割視窗
    tmux split-window -h
    
    # 在左側啟動後端
    tmux send-keys -t 0 'source .venv/bin/activate && cd api && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload' C-m
    
    # 在右側啟動前端
    tmux send-keys -t 1 'cd frontend && npm run dev' C-m
    
    # 附加到 session
    tmux attach-session -t llm-monitor
    
elif command -v screen &> /dev/null; then
    echo "使用 screen 同時啟動前後端..."
    
    # 啟動後端（背景執行）
    screen -dmS llm-backend bash start-backend.sh
    
    # 啟動前端
    bash start-frontend.sh
    
else
    echo "⚠️  建議安裝 tmux 或 screen 以便同時查看前後端日誌"
    echo "您可以執行：brew install tmux"
    echo ""
    echo "目前將依序啟動後端和前端..."
    echo "請在另一個終端視窗執行："
    echo "  ./start-backend.sh  # 啟動後端"
    echo "  ./start-frontend.sh # 啟動前端"
fi
