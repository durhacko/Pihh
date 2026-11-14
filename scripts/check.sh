#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export VITE_SIM_MODE=true
npm ci --no-audit --no-fund
npm run check
