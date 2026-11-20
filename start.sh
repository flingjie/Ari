#!/usr/bin/env bash
# 阿理（Ari）启动脚本：停掉旧进程，再启动新的前后端。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="$ROOT/backend.log"
FRONTEND_LOG="$ROOT/frontend.log"

# 本机 PyPI 直连会卡住，uv 统一走清华镜像。
export UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

# —— 1. 按端口精准停掉旧进程 ——
stop_port() {
  local port="$1" pids
  pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "→ 停止端口 $port 旧进程: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti:"$port" 2>/dev/null || true)"
    [ -z "$pids" ] || kill -9 $pids 2>/dev/null || true
  fi
}
stop_port "$BACKEND_PORT"
stop_port "$FRONTEND_PORT"

# —— 2. 依赖未装则先装 ——
if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "→ 安装后端依赖（uv sync，走镜像）..."
  (cd "$BACKEND_DIR" && uv sync)
fi
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "→ 安装前端依赖（npm install）..."
  (cd "$FRONTEND_DIR" && npm install)
fi

# —— 3. 启动（后台 + 日志；重定向放在子 shell 外层，避免占用脚本输出管道） ——
echo "→ 启动后端 http://localhost:$BACKEND_PORT ..."
( cd "$BACKEND_DIR" && nohup uv run uvicorn ari.main:app --port "$BACKEND_PORT" ) \
  > "$BACKEND_LOG" 2>&1 < /dev/null &
echo "→ 启动前端 http://localhost:$FRONTEND_PORT ..."
( cd "$FRONTEND_DIR" && nohup npm run dev ) > "$FRONTEND_LOG" 2>&1 < /dev/null &

# —— 4. 等待就绪 ——
echo "→ 等待服务就绪..."
for _ in $(seq 1 40); do
  if curl -s -m 2 -o /dev/null "http://localhost:$BACKEND_PORT/api/workspaces/" 2>/dev/null \
     && curl -s -m 2 -o /dev/null "http://localhost:$FRONTEND_PORT/" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

echo ""
echo "✔ 阿理已启动"
echo "  前端: http://localhost:$FRONTEND_PORT"
echo "  后端: http://localhost:$BACKEND_PORT  (API 文档 http://localhost:$BACKEND_PORT/docs)"
echo "  后端日志: $BACKEND_LOG"
echo "  前端日志: $FRONTEND_LOG"
echo ""
echo "  停止: kill \$(lsof -ti:$BACKEND_PORT) \$(lsof -ti:$FRONTEND_PORT) 2>/dev/null"
