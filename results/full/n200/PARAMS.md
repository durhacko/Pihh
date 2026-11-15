# Frozen evaluation parameters (n0 = 200)

Written by `scripts/eval/freeze-run.sh` at commit `0b2f8f3c7c57f1f3d34adf99a1748ab20baae973`. Every RunRecord in this directory carries `paramsHash` = the sha256 below.

- Source: `makeParams(200)` from `src/contracts/params.ts` (claimGap = max(2, ceil(0.03 · n0)) = 6).
- `paramsHash` = sha256 of the canonical JSON (keys sorted at every level, no whitespace), as computed by `paramsHash()` in `src/cli/run.ts`.

```text
paramsHash: 6342c662955320742188728c5ff096dbc1ef6afb0117fc2f04194b71c18091f2
```

```json
{
  "aMax": 8,
  "claimGap": 6,
  "claimWindow": 20,
  "dAvoid": 1.4,
  "dCollide": 0.4,
  "dNear": 0.8,
  "hbPeriod": 5,
  "historyMax": 8,
  "holdGrace": 40,
  "latencyMax": 2,
  "latencyMin": 1,
  "loss": 0.05,
  "n0": 200,
  "rClaim": 6,
  "rOcc": 0.6,
  "rRadio": 15,
  "rSense": 8,
  "scoreJitter": 10,
  "scoreLead": 60,
  "scoreResendMin": 40,
  "slotSpacingMin": 1.5,
  "tDeaf": 40,
  "tSettle": 20,
  "tStable": 120,
  "tSuspect": 60,
  "tVacant": 40,
  "transitLanes": false,
  "vMax": 8,
  "yieldTicks": 20
}
```
