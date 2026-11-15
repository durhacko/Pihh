#!/usr/bin/env bash
# scripts/eval/freeze-run.sh
# One command for the final evidence run (docs/validation/evaluation-and-tests.md §5), from a clean checkout of
# origin/main. It never commits.
#
#   bash scripts/eval/freeze-run.sh                 # minimum matrix into results/
#   FREEZE_FULL=1 bash scripts/eval/freeze-run.sh   # then also the full matrix into results/full/n200 and results/full/n100
#   FREEZE_JOBS=3 (default)                         # at most this many eval processes at once
#   FREEZE_FULL_SPECS="200:S0:1-2 100:S1:1-1"       # testing only: a smaller full matrix (n0:scenarios:seeds, space-separated)
#
# Minimum matrix: S0, S1, S2, S3, S5 × seeds 1-5 × both arms, n0 = 200, into results/ (top level).
# Full matrix (FREEZE_FULL=1): S0-S5 × seeds 1-20 × both arms at n0 = 200, plus S1, S2 × seeds 1-20 × both arms at
# n0 = 100 (§3 SHOULD), 320 records, into results/full/n200/ and results/full/n100/, each with its own PARAMS.md and
# RESULTS.md. Never into the top level.
#
# Steps:
#   0. refuse unless the tree is clean and HEAD equals origin/main; refuse if results/ (top level) holds records outside
#      the minimum matrix (they belong in results/full/), or if results/RESULTS.md has content but no notes section;
#   1. npm ci (before any helper, which needs tsx) and scripts/check.sh;
#   2. results/PARAMS.md must hold the paramsHash of the params in the code (a change is a new revision, §5 step 5);
#   3. run the matrix into a staging directory; check every record carries HEAD and that paramsHash;
#   4. replay one Encore record per scenario (seed 3): equal stateHash, summary and series;
#   5. install: if every old record equals its new one apart from `git`, replace them; otherwise move the old records,
#      RESULTS.md and PARAMS.md to <dir>/superseded-<old sha>/ (§5 step 5: keep the old table, labelled superseded);
#      then every record in results/ (top level) must carry HEAD;
#   6. regenerate the generated section of RESULTS.md, keep the hand-written notes byte-for-byte, print the diff of
#      the old and new tables, and flag notes lines that need a manual update.
# Exit status: 0 = done; 5 = done, but notes need a manual update (flagged above); anything else = failed.
set -euo pipefail
cd "$(dirname "$0")/../.."
JOBS="${FREEZE_JOBS:-3}"
FULL="${FREEZE_FULL:-0}"
N0=200
MIN_SCENARIOS=(S0 S1 S2 S3 S5)
MIN_SPEC="200:S0,S1,S2,S3,S5:1-5"
REPLAY_SEED=3
helper() { npx --no-install tsx scripts/eval/freeze-helpers.ts "$@"; }
step() { printf '\n== %s\n' "$*"; }
die() { echo "FREEZE: $*" >&2; exit 1; }
REVIEW=0
note_review() { if [ "$1" = 5 ]; then REVIEW=5; elif [ "$1" != 0 ]; then die "the notes review failed (status $1)"; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LOGS="$WORK/logs"; mkdir -p "$LOGS"
export LOGS

step "0. Preconditions"
git fetch -q origin
HEAD_SHA="$(git rev-parse HEAD)"
MAIN_SHA="$(git rev-parse origin/main)"
echo "HEAD        $HEAD_SHA"
echo "origin/main $MAIN_SHA"
[ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the working tree is not clean (see above)"; }
[ "$HEAD_SHA" = "$MAIN_SHA" ] || die "HEAD is not origin/main: check out origin/main (git switch --detach origin/main) and run again"
[ -f results/PARAMS.md ] || die "results/PARAMS.md is missing: freeze the params first (evaluation doc §5 step 2)"
if [ "$FULL" = 1 ]; then echo "mode: minimum matrix + full matrix (FREEZE_FULL=1); at most $JOBS processes"; else echo "mode: minimum matrix; at most $JOBS processes"; fi
# The helpers below need tsx, so install first (a fresh checkout has no node_modules).
npm ci --no-audit --no-fund
set +e; helper extras results "$MIN_SPEC"; rc=$?; set -e
case "$rc" in
  0) ;;
  7) die "results/ (top level) may hold only the minimum matrix; move the records above to results/full/ (or elsewhere) and run again" ;;
  *) die "checking results/ for records outside the minimum matrix failed (status $rc)" ;;
esac
# Read the notes now, so a missing marker stops the run before any work rather than losing the notes after it.
cp results/RESULTS.md "$WORK/RESULTS.old.md" 2>/dev/null || : > "$WORK/RESULTS.old.md"
set +e; helper split "$WORK/RESULTS.old.md" "$WORK/generated.old.md" "$WORK/notes.md" --require-notes; rc=$?; set -e
case "$rc" in
  0) ;;
  6) die "results/RESULTS.md: no notes section found (see above); nothing was run" ;;
  *) die "reading results/RESULTS.md failed (status $rc)" ;;
esac
# The full matrix: FREEZE_FULL_SPECS overrides it (space-separated n0:scenarios:lo-hi specs), for testing a small one.
read -r -a FULL_SPECS <<< "${FREEZE_FULL_SPECS:-200:S0,S1,S2,S3,S4,S5:1-20 100:S1,S2:1-20}"
if [ "$FULL" = 1 ]; then
  for spec in "${FULL_SPECS[@]}"; do
    dir="results/full/n${spec%%:*}"
    [ -d "$dir" ] || continue
    set +e; helper extras "$dir" "$spec"; rc=$?; set -e
    case "$rc" in
      0) ;;
      7) die "$dir may hold only the records of $spec; move the JSON files above elsewhere and run again" ;;
      *) die "checking $dir for other JSON files failed (status $rc)" ;;
    esac
    set +e; helper split "$dir/RESULTS.md" "$WORK/precheck.gen" "$WORK/precheck.notes"; rc=$?; set -e
    case "$rc" in
      0) ;;
      6) die "$dir/RESULTS.md: notes that would be lost (see above); nothing was run" ;;
      *) die "reading $dir/RESULTS.md failed (status $rc)" ;;
    esac
  done
fi

step "1. scripts/check.sh"
bash scripts/check.sh

step "2. Frozen params"
FROZEN_HASH="$(sed -n 's/^paramsHash: \([0-9a-f]\{64\}\)$/\1/p' results/PARAMS.md)"
CODE_HASH="$(helper params-hash "$N0")"
echo "PARAMS.md   $FROZEN_HASH"
echo "code        $CODE_HASH"
[ -n "$FROZEN_HASH" ] || die "no 'paramsHash: <sha256>' line in results/PARAMS.md"
[ "$FROZEN_HASH" = "$CODE_HASH" ] || die "the params in the code differ from results/PARAMS.md: that is a new revision (§5 step 5); update PARAMS.md deliberately first"

# run_jobs <stage> <n0> <total> <job>...   each job is "SCENARIO:SEEDS"; prints a line as each finishes (progress)
run_jobs() {
  local stage="$1" n0="$2" total="$3"; shift 3
  local t0; t0=$(date +%s)
  export STAGE_DIR="$stage" JOB_N0="$n0" JOB_TOTAL="$total" JOB_T0="$t0"
  # shellcheck disable=SC2016  # the inner script expands its own variables
  printf '%s\n' "$@" | xargs -P "$JOBS" -I{} sh -c '
    job={}; s=${job%%:*}; seeds=${job#*:}; start=$(date +%s)
    npm run -s eval -- --scenario "$s" --seeds "$seeds" --arms static,encore --n0 "$JOB_N0" --out "$STAGE_DIR" > "$LOGS/$s-n$JOB_N0-$seeds.log" 2>&1 \
      || { echo "FREEZE: $s n0 $JOB_N0 seeds $seeds failed:"; tail -20 "$LOGS/$s-n$JOB_N0-$seeds.log"; exit 255; }
    done=$(ls "$STAGE_DIR" | grep -c "\.json$")
    echo "  [$done/$JOB_TOTAL records, $(( $(date +%s) - JOB_T0 )) s] $s n0 $JOB_N0 seeds $seeds done in $(( $(date +%s) - start )) s"'
}

# install_set <stage> <dir> <spec> : replace or supersede the records of <spec> in <dir>, then move the new ones in
install_set() {
  local stage="$1" dir="$2" spec="$3" cmp old sup
  mkdir -p "$dir"
  set +e; helper compare "$dir" "$stage" "$spec"; cmp=$?; set -e
  case "$cmp" in
    0) echo "same behaviour as before: the previous records in $dir are replaced by HEAD's (they differ only in git)"
       for f in "$stage"/*.json; do rm -f "$dir/$(basename "$f")"; done ;;
    3) old="$(helper old-git "$dir" "$spec")"
       sup="$dir/superseded-$old"
       [ ! -e "$sup" ] || die "$sup already exists"
       echo "behaviour changed since $old: moving the previous records, RESULTS.md and PARAMS.md of $dir to $sup/"
       mkdir -p "$sup"
       for f in "$stage"/*.json; do [ -e "$dir/$(basename "$f")" ] && mv "$dir/$(basename "$f")" "$sup/"; done
       if [ -f "$dir/RESULTS.md" ]; then
         { echo "> **SUPERSEDED** by the run at \`$HEAD_SHA\` (scripts/eval/freeze-run.sh): kept as the old table, evaluation doc §5 step 5."; echo; cat "$dir/RESULTS.md"; } > "$sup/RESULTS.md"
       fi
       [ ! -f "$dir/PARAMS.md" ] || cp "$dir/PARAMS.md" "$sup/PARAMS.md" ;;
    4) echo "no previous records in $dir" ;;
    *) die "comparing with the previous records in $dir failed (status $cmp)" ;;
  esac
  mv "$stage"/*.json "$dir/"
}

# results_md <dir> <oldResults> <requireNotes> : regenerate the generated section of <dir>/RESULTS.md, keep notes
results_md() {
  local dir="$1" old="$2" req="$3" tag rv
  tag="$(echo "$dir" | tr '/' '_')"
  if [ "$req" = 1 ]; then cp "$WORK/generated.old.md" "$WORK/$tag.gen.old"; cp "$WORK/notes.md" "$WORK/$tag.notes";
  else helper split "$old" "$WORK/$tag.gen.old" "$WORK/$tag.notes" || die "reading the old $dir/RESULTS.md failed (it was checked at step 0)"; fi
  npm run -s eval -- --report "$dir" --report-out "$WORK/$tag.gen.new" >/dev/null
  { cat "$WORK/$tag.gen.new"; if [ -s "$WORK/$tag.notes" ]; then echo; cat "$WORK/$tag.notes"; fi; } > "$dir/RESULTS.md"
  echo "--- $dir/RESULTS.md: diff of the generated tables (old -> new) ---"
  diff -u --label "generated (old)" --label "generated (new)" "$WORK/$tag.gen.old" "$WORK/$tag.gen.new" || true
  echo "--- end of diff ---"
  set +e; helper review "$WORK/$tag.gen.old" "$WORK/$tag.gen.new" "$WORK/$tag.notes"; rv=$?; set -e
  note_review "$rv"
}

step "3. Minimum matrix: ${MIN_SCENARIOS[*]} × seeds 1-5 × static,encore, n0 $N0"
STAGE="$WORK/min"; mkdir -p "$STAGE"
echo "load before: $(cat /proc/loadavg 2>/dev/null || echo n/a)"
T0=$(date +%s)
run_jobs "$STAGE" "$N0" 50 S0:1-5 S1:1-5 S2:1-5 S3:1-5 S5:1-5
T1=$(date +%s)
echo "matrix wall-clock: $((T1 - T0)) s; load after: $(cat /proc/loadavg 2>/dev/null || echo n/a)"
helper check "$STAGE" "$HEAD_SHA" "$FROZEN_HASH" "$MIN_SPEC"

step "4. Replay: one Encore record per scenario, seed $REPLAY_SEED"
REPLAY="$WORK/replay"; mkdir -p "$REPLAY"
export REPLAY REPLAY_SEED N0
# shellcheck disable=SC2016  # the inner script expands its own variables
printf '%s\n' "${MIN_SCENARIOS[@]}" | xargs -P "$JOBS" -I{} sh -c '
  npm run -s eval -- --scenario {} --seeds "$REPLAY_SEED" --arms encore --n0 "$N0" --out "$REPLAY" > "$LOGS/replay-{}.log" 2>&1 \
    || { echo "FREEZE: replay {} failed:"; tail -20 "$LOGS/replay-{}.log"; exit 255; }'
helper replay "$STAGE" "$REPLAY" "$MIN_SPEC" "$REPLAY_SEED"

step "5. Install the minimum matrix in results/"
install_set "$STAGE" results "$MIN_SPEC"
set +e; helper top-git results "$HEAD_SHA"; rc=$?; set -e
[ "$rc" = 0 ] || die "results/ (top level) holds JSON that is not a record of HEAD (listed above): not one frozen revision (status $rc)"

step "6. results/RESULTS.md: regenerate the generated section, keep the hand-written notes"
results_md results "$WORK/RESULTS.old.md" 1

if [ "$FULL" = 1 ]; then
  step "7. Full matrix (FREEZE_FULL=1) into results/full/"
  FT0=$(date +%s)
  for spec in "${FULL_SPECS[@]}"; do
    n0="${spec%%:*}"; rest="${spec#*:}"; scen="${rest%%:*}"; range="${rest#*:}"; lo="${range%-*}"; hi="${range#*-}"
    dir="results/full/n$n0"
    code_hash="$(helper params-hash "$n0")"
    if [ "$n0" = "$N0" ] && [ "$code_hash" != "$FROZEN_HASH" ]; then die "n0 $n0: params hash differs from results/PARAMS.md"; fi
    if [ -f "$dir/PARAMS.md" ]; then
      old_hash="$(sed -n 's/^paramsHash: \([0-9a-f]\{64\}\)$/\1/p' "$dir/PARAMS.md")"
      [ "$old_hash" = "$code_hash" ] || die "$dir/PARAMS.md holds another paramsHash ($old_hash): a new revision; update it deliberately first"
    fi
    count=$(( $(echo "$scen" | tr ',' '\n' | wc -l) * 2 * (hi - lo + 1) ))
    echo "-- n0 $n0: ${scen//,/ } × seeds $lo-$hi × both arms = $count records into $dir/"
    fstage="$WORK/full-n$n0"; mkdir -p "$fstage"
    # Two jobs per scenario (lower and upper half of the seeds), so the work spreads over FREEZE_JOBS processes.
    mid=$(( (lo + hi) / 2 ))
    jobs=(); IFS=',' read -r -a list <<< "$scen"
    for s in "${list[@]}"; do if [ "$hi" -gt "$lo" ]; then jobs+=("$s:$lo-$mid" "$s:$((mid + 1))-$hi"); else jobs+=("$s:$lo-$hi"); fi; done
    run_jobs "$fstage" "$n0" "$count" "${jobs[@]}"
    helper check "$fstage" "$HEAD_SHA" "$code_hash" "$spec"
    cp "$dir/RESULTS.md" "$WORK/full-n$n0.RESULTS.old.md" 2>/dev/null || : > "$WORK/full-n$n0.RESULTS.old.md"
    install_set "$fstage" "$dir" "$spec"
    set +e; helper top-git "$dir" "$HEAD_SHA"; rc=$?; set -e
    [ "$rc" = 0 ] || die "$dir holds records from another commit (listed above), or the check failed (status $rc)"
    helper params-md "$n0" "$HEAD_SHA" "$dir/PARAMS.md"
    results_md "$dir" "$WORK/full-n$n0.RESULTS.old.md" 0
  done
  # Cross-check: the default full matrix re-runs the minimum one; both must agree byte for byte apart from nothing.
  if [ -z "${FREEZE_FULL_SPECS:-}" ]; then
    set +e; helper compare results results/full/n200 "$MIN_SPEC" >/dev/null; rc=$?; set -e
    case "$rc" in
      0) echo "cross-check: results/full/n200 seeds 1-5 equal the minimum matrix in results/" ;;
      3) die "results/full/n200 disagrees with results/ on the minimum matrix: the runs are not reproducible" ;;
      *) die "the cross-check of results/full/n200 against results/ failed (status $rc)" ;;
    esac
  fi
  echo "full matrix wall-clock: $(( $(date +%s) - FT0 )) s"
fi

step "Done"
echo "HEAD $HEAD_SHA, paramsHash $FROZEN_HASH; minimum matrix $((T1 - T0)) s with at most $JOBS processes."
echo "Nothing is committed: review, then commit results/ in an evidence PR."
if [ "$REVIEW" = 5 ]; then echo "The hand-written notes NEED A MANUAL UPDATE (flagged above)."; fi
exit "$REVIEW"
