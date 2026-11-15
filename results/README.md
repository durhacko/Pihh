# results

Run records (`RunRecord`, contract §5) and the generated results table, written by the headless runner in `src/cli`. Procedure, scenarios and win rule: [evaluation and tests](../docs/validation/evaluation-and-tests.md).

```bash
npm run eval -- --scenario min --seeds 1-5 --arms static,encore --n0 200 --out results/   # minimum matrix (§5)
npm run eval -- --report results/ --report-out results/RESULTS.md                          # results table
```

**Final evidence run: one command.** From a clean checkout of `origin/main`, `bash scripts/eval/freeze-run.sh` does the following and never commits:
- runs `npm ci` and `scripts/check.sh`;
- checks the frozen params against [PARAMS.md](PARAMS.md);
- runs the minimum matrix (at most 3 processes, `FREEZE_JOBS` to change) and checks every record's `git` and `paramsHash`;
- replays one Encore record per scenario;
- replaces the records, or moves the old ones to `superseded-<sha>/` if behaviour changed;
- regenerates the generated part of RESULTS.md, keeps the hand-written notes, prints the table diff, and flags notes that need updating (exit 5).

It refuses before doing any work if:
- RESULTS.md has content but no notes section (a `---` rule and a `## Notes` heading);
- the top level holds records outside the minimum matrix.

After installing, every top-level record must carry HEAD.

`FREEZE_FULL=1` also runs the full matrix (S0–S5 × seeds 1–20 × both arms at n0 = 200, plus S1 and S2 × seeds 1–20 at n0 = 100; 320 records, about 27 min at 3 processes) into `full/n200/` and `full/n100/`. Each gets its own PARAMS.md and RESULTS.md, and progress is printed as each job finishes. This never writes to the top level.

One JSON file per (scenario, n0, arm, seed): `S2_n200_static_s1.json`. Records hold no wall-clock values, so a re-run from the same commit and params gives an equal `stateHash` and `summary`.

The minimum matrix (S0, S1, S2, S3, S5; seeds 1-5; both arms; n0 = 200) from `main` 571c8e4 is here: [RESULTS.md](RESULTS.md), with the frozen params in [PARAMS.md](PARAMS.md).
