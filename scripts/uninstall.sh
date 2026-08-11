#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/stop.sh
rm -rf .control-panel

echo "Removed ASCII Diagram Renderer control-panel runtime files."
