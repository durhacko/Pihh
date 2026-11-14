#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_SIM_MODE=true
npm run check
python scripts/check_links.py
