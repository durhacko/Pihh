#!/usr/bin/env bash
# integrations/gateway/scripts/gemini-live.sh — start the gateway with the `gemini` module LIVE (D3, #218; free quota only).
#
# The key is never in the repo, never on the command line and never printed. It lives in a private file outside the
# repo, ~/.config/encore/gemini.env (mode 600), with one line `GEMINI_API_KEY=...`, which Arnav provisions. This script
# loads that file into the environment without echoing it, then runs the gateway's normal entry point (src/server.ts),
# which passes only GEMINI_* variables to the gemini module and holds the key as a Secret.
#
# Usage:  integrations/gateway/scripts/gemini-live.sh            (listens on http://127.0.0.1:8787)
# Options, from the environment: GEMINI_MODEL (default gemini-3.1-flash-lite), GATEWAY_PORT, GATEWAY_ALLOWED_ORIGINS
# (default http://localhost:5173), GEMINI_ENV_FILE (default ~/.config/encore/gemini.env).
#
# Never add `set -x`, `env`, `printenv` or an echo of any variable from the env file to this script.
set -euo pipefail

ENV_FILE="${GEMINI_ENV_FILE:-$HOME/.config/encore/gemini.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "gemini-live: no key file at $ENV_FILE (Arnav provisions it; mode 600, one line GEMINI_API_KEY=...)" >&2
  exit 1
fi
MODE="$(stat -c '%a' "$ENV_FILE")"
if [ "$MODE" != "600" ] && [ "$MODE" != "400" ]; then
  echo "gemini-live: $ENV_FILE must be readable by its owner only (mode 600), not $MODE" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# Load the key file silently: exported for the gateway process only, never echoed or logged.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export GEMINI_ENABLED=1
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"
export GATEWAY_ALLOWED_ORIGINS="${GATEWAY_ALLOWED_ORIGINS:-http://localhost:5173}"

# The one thing this script says about its configuration: the model (not a secret). The gateway's own start-up log
# then says `module gemini: enabled` (or disabled, if the key line is missing), and never prints the key.
echo "gemini-live: model ${GEMINI_MODEL}" >&2

exec node --experimental-strip-types --disable-warning=ExperimentalWarning --import ./loader/register.mjs src/server.ts
