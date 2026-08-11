#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p .control-panel
npm install
npm run build

echo "Initialized ASCII Diagram Renderer."
