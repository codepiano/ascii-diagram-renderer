#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source "./scripts/service-common.sh"

LOG_FILE=".control-panel/demo.log"
mkdir -p .control-panel

if ./scripts/status.sh >/dev/null 2>&1; then
  echo "ASCII Diagram Renderer demo is already running."
  exit 0
fi

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use; refusing to start ASCII Diagram Renderer." >&2
  exit 1
fi

npm run build

tmux new-session -d -s "$SESSION_NAME" -c "$ROOT_DIR" \
  "exec python3 -m http.server '$PORT' --bind 127.0.0.1 >> '$LOG_FILE' 2>&1"

for _ in $(seq 1 30); do
  if ./scripts/status.sh >/dev/null 2>&1; then
    echo "Started ASCII Diagram Renderer demo at $APP_URL"
    exit 0
  fi
  sleep 0.5
done

echo "ASCII Diagram Renderer demo failed to start. See $LOG_FILE" >&2
exit 1
