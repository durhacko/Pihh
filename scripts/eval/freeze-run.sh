#!/usr/bin/env bash
# scripts/eval/freeze-run.sh
# One command for the final evidence run (docs/validation/evaluation-and-tests.md §5): the minimum matrix
# (S0, S1, S2, S3, S5 × seeds 1-5 × both arms, n0 = 200) from a clean checkout of origin/main, into results/.
#
#   bash scripts/eval/freeze-run.sh            # FREEZE_JOBS=3 by default (at most 3 eval processes at once)
#
# It refuses to run unless the tree is clean and HEAD equals origin/main. It then:
#   1. runs npm ci and scripts/check.sh;
#   2. checks that results/PARAMS.md holds the paramsHash of the params in the code (a change is a new revision);
#   3. runs the matrix into a staging directory, then checks every record carries HEAD and that paramsHash;
#   4. re-runs one Encore record per scenario (seed 3) and asserts equal stateHash, summary and series;
#   5. compares with the records already in results/: identical apart from `git` => they are replaced;
#      any difference => the old records, RESULTS.md and PARAMS.md move to results/superseded-<old sha>/ (§5 step 5);
#   6. regenerates the generated section of results/RESULTS.md, keeps the hand-written notes section below its
#      "---" line, prints a diff of the old and new generated tables, and flags notes that need a manual update.
# It never commits. Exit status: 0 = done, notes need no review; 5 = done, notes need review; anything else = failed.
set -euo pipefail
cd "$(dirname "$0")/../.."
JOBS="${FREEZE_JOBS:-3}"
SCENARIOS=(S0 S1 S2 S3 S5)
SEEDS="1-5"
N0=200
REPLAY_SEED=3
helper() { npx --no-install tsx scripts/eval/freeze-helpers.ts "$@"; }
step() { printf '\n== %s\n' "$*"; }
die() { echo "FREEZE: $*" >&2; exit 1; }

step "0. Preconditions"
git fetch -q origin
HEAD_SHA="$(git rev-parse HEAD)"
MAIN_SHA="$(git rev-parse origin/main)"
echo "HEAD        $HEAD_SHA"
echo "origin/main $MAIN_SHA"
[ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the working tree is not clean (see above)"; }
[ "$HEAD_SHA" = "$MAIN_SHA" ] || die "HEAD is not origin/main: check out origin/main (git switch --detach origin/main) and run again"
[ -f results/PARAMS.md ] || die "results/PARAMS.md is missing: freeze the params first (evaluation doc §5 step 2)"

step "1. npm ci and scripts/check.sh"
npm ci --no-audit --no-fund
bash scripts/check.sh

step "2. Frozen params"
FROZEN_HASH="$(sed -n 's/^paramsHash: \([0-9a-f]\{64\}\)$/\1/p' results/PARAMS.md)"
CODE_HASH="$(helper params-hash)"
echo "PARAMS.md   $FROZEN_HASH"
echo "code        $CODE_HASH"
[ -n "$FROZEN_HASH" ] || die "no 'paramsHash: <sha256>' line in results/PARAMS.md"
[ "$FROZEN_HASH" = "$CODE_HASH" ] || die "the params in the code differ from results/PARAMS.md: that is a new revision (§5 step 5); update PARAMS.md deliberately first"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/records"; REPLAY="$WORK/replay"; LOGS="$WORK/logs"
mkdir -p "$STAGE" "$REPLAY" "$LOGS"
export STAGE REPLAY LOGS SEEDS N0 REPLAY_SEED

step "3. Minimum matrix: ${SCENARIOS[*]} × seeds $SEEDS × static,encore, n0 $N0, at most $JOBS processes"
echo "load before: $(cat /proc/loadavg 2>/dev/null || echo n/a)"
T0=$(date +%s)
# shellcheck disable=SC2016  # the inner script expands its own variables
printf '%s\n' "${SCENARIOS[@]}" | xargs -P "$JOBS" -I{} sh -c '
  start=$(date +%s)
  npm run -s eval -- --scenario {} --seeds "$SEEDS" --arms static,encore --n0 "$N0" --out "$STAGE" > "$LOGS/{}.log" 2>&1 \
    || { echo "FREEZE: scenario {} failed:"; tail -20 "$LOGS/{}.log"; exit 255; }
  echo "{}: 10 runs in $(( $(date +%s) - start )) s"'
T1=$(date +%s)
echo "matrix wall-clock: $((T1 - T0)) s"
echo "load after:  $(cat /proc/loadavg 2>/dev/null || echo n/a)"
helper check "$STAGE" "$HEAD_SHA" "$FROZEN_HASH"

step "4. Replay: one Encore record per scenario, seed $REPLAY_SEED"
# shellcheck disable=SC2016  # the inner script expands its own variables
printf '%s\n' "${SCENARIOS[@]}" | xargs -P "$JOBS" -I{} sh -c '
  npm run -s eval -- --scenario {} --seeds "$REPLAY_SEED" --arms encore --n0 "$N0" --out "$REPLAY" > "$LOGS/replay-{}.log" 2>&1 \
    || { echo "FREEZE: replay {} failed:"; tail -20 "$LOGS/replay-{}.log"; exit 255; }'
helper replay "$STAGE" "$REPLAY"

step "5. Compare with the records already in results/"
# shellcheck disable=SC2016  # the backticks are literal Markdown
OLD_GIT="$(sed -n 's/^Records: .* git: `\([0-9a-f]*\)`.*/\1/p' results/RESULTS.md 2>/dev/null | head -1)"
set +e; helper compare results "$STAGE"; CMP=$?; set -e
cp results/RESULTS.md "$WORK/RESULTS.old.md" 2>/dev/null || : > "$WORK/RESULTS.old.md"
case "$CMP" in
  0) echo "same behaviour as ${OLD_GIT:0:12}: the previous records are replaced by HEAD's (they differ only in git)"
     rm -f results/S[0-35]_n${N0}_static_s[1-5].json results/S[0-35]_n${N0}_encore_s[1-5].json ;;
  3) SUP="results/superseded-${OLD_GIT:0:7}"
     [ -n "$OLD_GIT" ] || die "the previous records differ but RESULTS.md names no commit to label them with"
     [ ! -e "$SUP" ] || die "$SUP already exists"
     echo "behaviour changed since ${OLD_GIT:0:12}: moving the previous records, RESULTS.md and PARAMS.md to $SUP/"
     mkdir -p "$SUP"
     mv results/S[0-35]_n${N0}_static_s[1-5].json results/S[0-35]_n${N0}_encore_s[1-5].json "$SUP/"
     { echo "> **SUPERSEDED** by the run at \`$HEAD_SHA\` (scripts/eval/freeze-run.sh): kept as the old table, evaluation doc §5 step 5."; echo; cat results/RESULTS.md; } > "$SUP/RESULTS.md"
     cp results/PARAMS.md "$SUP/PARAMS.md" ;;
  4) echo "no previous records in results/" ;;
  *) die "comparing with the previous records failed (status $CMP)" ;;
esac
mv "$STAGE"/*.json results/

step "6. RESULTS.md: regenerate the generated section, keep the hand-written notes"
helper split "$WORK/RESULTS.old.md" "$WORK/generated.old.md" "$WORK/notes.md"
npm run -s eval -- --report results --report-out "$WORK/generated.new.md" >/dev/null
{ cat "$WORK/generated.new.md"; if [ -s "$WORK/notes.md" ]; then echo; cat "$WORK/notes.md"; fi; } > results/RESULTS.md
echo "--- diff of the generated tables (old -> new) ---"
diff -u --label "generated (old)" --label "generated (new)" "$WORK/generated.old.md" "$WORK/generated.new.md" || true
echo "--- end of diff ---"
set +e; helper review "$WORK/generated.old.md" "$WORK/generated.new.md" "$WORK/notes.md"; REVIEW=$?; set -e
[ "$REVIEW" = 0 ] || [ "$REVIEW" = 5 ] || die "the notes review failed (status $REVIEW)"

step "Done"
echo "HEAD $HEAD_SHA, paramsHash $FROZEN_HASH, matrix $((T1 - T0)) s with at most $JOBS processes."
echo "results/ now holds HEAD's records. Nothing is committed: review, then commit results/ in an evidence PR."
if [ "$REVIEW" = 5 ]; then echo "The hand-written notes in results/RESULTS.md NEED A MANUAL UPDATE (flagged above)."; fi
exit "$REVIEW"
