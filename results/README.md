# results

Run records (`RunRecord`, contract §5) and the generated results table, written by the headless runner in `src/cli`. Procedure, scenarios and win rule: [evaluation and tests](../docs/validation/evaluation-and-tests.md).

```bash
npm run eval -- --scenario min --seeds 1-5 --arms static,encore --n0 200 --out results/   # minimum matrix (§5)
npm run eval -- --report results/ --report-out results/RESULTS.md                          # results table
```

One JSON file per (scenario, n0, arm, seed): `S2_n200_static_s1.json`. Records hold no wall-clock values, so a re-run from the same commit and params gives an equal `stateHash` and `summary`.

Nothing here is evidence yet: the evaluation run waits for the Encore brain (#16).
