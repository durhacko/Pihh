#!/usr/bin/env bash
# integrations/gateway/scripts/gemini-live.sh — start the gateway with the `gemini` module LIVE (D3, #218; free quota only).
#
# The key is never in the repo, never on the command line and never printed. It lives in a private file outside the
# repo, ~/.config/encore/gemini.env (mode 600, owned by you, not a symlink, in a directory nobody else can write),
# with one line `GEMINI_API_KEY=...`, which Arnav provisions. The file is opened once and checked through that open
# descriptor (Linux /proc). This script does NOT source it: it reads only the GEMINI_API_KEY= line, as data (no shell
# expansion, no other variable, no command in the file ever runs), checks the value's shape without printing it, and
# runs the gateway's normal entry point (src/server.ts), which passes only GEMINI_* variables to the gemini module and
# holds the key as a Secret.
#
# Usage:  integrations/gateway/scripts/gemini-live.sh            (listens on http://127.0.0.1:8787)
# Options, from the environment: GEMINI_MODEL (default gemini-3.1-flash-lite), GEMINI_RESPONSE_SCHEMA (default
# ranges, the mode that gave valid live scenes; see src/gemini/.env.example), GEMINI_MAX_CALLS (default 50 in the
# module), GATEWAY_PORT, GATEWAY_ALLOWED_ORIGINS (default http://localhost:5173), GEMINI_ENV_FILE (default
# ~/.config/encore/gemini.env). GEMINI_LIVE_CHECK_ONLY=1 checks the key file and exits without starting anything.
#
# Never add `set -x`, `env`, `printenv` or an echo of the key to this script.
set -euo pipefail

ENV_FILE="${GEMINI_ENV_FILE:-$HOME/.config/encore/gemini.env}"
fail() { echo "gemini-live: $1" >&2; exit 1; }

ME="$(id -u)"
[ -L "$ENV_FILE" ] && fail "$ENV_FILE is a symlink; use the file itself"
[ -f "$ENV_FILE" ] || fail "no key file at $ENV_FILE (Arnav provisions it; mode 600, one line GEMINI_API_KEY=...)"
# Its directory must be yours (or root's) and not writable by group or others, so nobody else can swap the file.
read -r DIR_OWNER DIR_MODE < <(stat -L -c '%u %a' -- "$(dirname -- "$ENV_FILE")")
{ [ "$DIR_OWNER" = "$ME" ] || [ "$DIR_OWNER" = "0" ]; } || fail "the directory of $ENV_FILE must be owned by you"
(( (8#$DIR_MODE & 8#022) == 0 )) || fail "the directory of $ENV_FILE must not be writable by group or others (mode $DIR_MODE)"
# Open the file ONCE; every check below and the read run on that open file (fd 3), so what is checked is what is read.
exec 3< "$ENV_FILE" || fail "cannot open $ENV_FILE"
[ "$(stat -L -c '%F' /proc/self/fd/3)" = "regular file" ] || fail "$ENV_FILE is not a regular file"
[ "$(stat -L -c '%u' /proc/self/fd/3)" = "$ME" ] || fail "$ENV_FILE must be owned by you"
MODE="$(stat -L -c '%a' /proc/self/fd/3)"
[ "$MODE" = "600" ] || [ "$MODE" = "400" ] || fail "$ENV_FILE must be readable by its owner only (mode 600), not $MODE"

# Read the one GEMINI_API_KEY= line as data. Surrounding quotes and a trailing CR are tolerated; nothing is expanded.
KEY=""
FOUND=0
while IFS= read -r line <&3 || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in
    GEMINI_API_KEY=*|"export GEMINI_API_KEY="*) KEY="${line#*GEMINI_API_KEY=}"; FOUND=1; break ;;
  esac
done
exec 3<&-
unset line
[ "$FOUND" = 1 ] || fail "$ENV_FILE has no GEMINI_API_KEY= line"
case "$KEY" in
  \"*\") KEY="${KEY#\"}"; KEY="${KEY%\"}" ;;
  \'*\') KEY="${KEY#\'}"; KEY="${KEY%\'}" ;;
esac
# A Google API key is letters, digits, '.', '_' and '-'. Anything else is refused, and the value is never shown.
[[ "$KEY" =~ ^[A-Za-z0-9._-]{20,256}$ ]] || fail "the GEMINI_API_KEY value in $ENV_FILE is not key-shaped (not shown)"

if [ "${GEMINI_LIVE_CHECK_ONLY:-}" = "1" ]; then
  unset KEY
  echo "gemini-live: key file ok" >&2
  exit 0
fi

cd "$(dirname "$0")/.."

export GEMINI_API_KEY="$KEY"
unset KEY
export GEMINI_ENABLED=1
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"
export GEMINI_RESPONSE_SCHEMA="${GEMINI_RESPONSE_SCHEMA:-ranges}"
export GATEWAY_ALLOWED_ORIGINS="${GATEWAY_ALLOWED_ORIGINS:-http://localhost:5173}"

# What this script says about its configuration: the model and the schema mode (not secrets). The gateway's own
# start-up log then says `module gemini: enabled`, and never prints the key.
echo "gemini-live: model ${GEMINI_MODEL}, response schema ${GEMINI_RESPONSE_SCHEMA}" >&2

exec node --experimental-strip-types --disable-warning=ExperimentalWarning --import ./loader/register.mjs src/server.ts
