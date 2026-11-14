#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_SIM_MODE=true
npm run check
"$(command -v python3 || command -v python)" scripts/check_links.py
