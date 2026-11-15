# Evaluation results

Records: 50. git: `0b2f8f3c7c57f1f3d34adf99a1748ab20baae973`. paramsHash: `6342c6629553`.

Medians and IQRs skip null values, counted separately: `n/a` = not applicable (e.g. `npwcDeficitSec` with no event), `—` = key absent (e.g. `tRec` without a KILL). Exception: a censored `tRec` (not recovered) ranks above every recovered seed, and a quantile that lands on one prints `censored`. Deltas and win/tie/loss use fair pairs only (same git, paramsHash and events); other pairs are listed as MISMATCH. `npwc` is priority-weighted by our own slot order: read it beside `coverage`, `sfMean` and `sfMax`.

### S0 (n0 = 200)

Seeds: static 5, encore 5, fair pairs 5, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 1.000 | 1.000 | 0 | TIE |
| 2 | 1.000 | 1.000 | 0 | TIE |
| 3 | 1.000 | 1.000 | 0 | TIE |
| 4 | 1.000 | 1.000 | 0 | TIE |
| 5 | 1.000 | 1.000 | 0 | TIE |

Win/tie/loss: **0 / 5 / 0** of 5 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.
tRec censored (not recovered): static n/a (no KILL), encore n/a (no KILL).

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 1.000 [1.000–1.000] (n=5) | 1.000 [1.000–1.000] (n=5) | 0.000 (5 pairs) |
| `npwcEndA` | 1.000 [1.000–1.000] (n=5) | 1.000 [1.000–1.000] (n=5) | 0.000 (5 pairs) |
| `coverageEnd` | 1 [1–1] (n=5) | 1 [1–1] (n=5) | 0 (5 pairs) |
| `sfMeanEnd` | 0.935 [0.935–0.935] (n=5) | 0.935 [0.935–0.935] (n=5) | 0.000 (5 pairs) |
| `sfMaxEnd` | 1.972 [1.972–1.972] (n=5) | 1.972 [1.972–1.972] (n=5) | 0.000 (5 pairs) |
| `sfMaxEndA` | 1.598 [1.598–1.598] (n=5) | 1.598 [1.598–1.598] (n=5) | 0.000 (5 pairs) |
| `capacityLoss` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `coordLoss` | 0.000 [0.000–0.000] (n=5) | 0.000 [0.000–0.000] (n=5) | 0.000 (5 pairs) |
| `npwcDeficitSec` | n/a ×5 | n/a ×5 | — |
| `slotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `collisions` | 14 [14–14] (n=5) | 14 [14–14] (n=5) | 0 (5 pairs) |
| `nearMisses` | 250 [250–250] (n=5) | 250 [250–250] (n=5) | 0 (5 pairs) |
| `msgsPerDroneSec` | 0 [0–0] (n=5) | 4 [4–4] (n=5) | 4 (5 pairs) |
| `deliveryRatio` | n/a ×5 | 0.950 [0.950–0.950] (n=5) | — |
| `adoptP50` | n/a ×5 | n/a ×5 | — |
| `adoptMax` | n/a ×5 | n/a ×5 | — |
| `unadopted` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `splitSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `tVersion` | n/a ×5 | n/a ×5 | — |

### S1 (n0 = 200)

Seeds: static 5, encore 5, fair pairs 5, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.927 | 0.998 | 0.071 | WIN |
| 2 | 0.905 | 0.995 | 0.090 | WIN |
| 3 | 0.910 | 0.997 | 0.087 | WIN |
| 4 | 0.912 | 0.997 | 0.085 | WIN |
| 5 | 0.921 | 0.999 | 0.077 | WIN |

Win/tie/loss: **5 / 0 / 0** of 5 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.071.
tRec censored (not recovered): static 5 of 5, encore 0 of 5.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.912 [0.910–0.921] (n=5) | 0.997 [0.997–0.998] (n=5) | 0.085 (5 pairs) |
| `npwcEndA` | 0.912 [0.910–0.921] (n=5) | 0.987 [0.987–0.993] (n=5) | 0.082 (5 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=5) | 0.900 [0.900–0.900] (n=5) | 0.000 (5 pairs) |
| `sfMeanEnd` | 1.017 [1.007–1.017] (n=5) | 0.978 [0.978–0.979] (n=5) | -0.037 (5 pairs) |
| `sfMaxEnd` | 2.659 [2.653–2.685] (n=5) | 2.024 [2.024–2.084] (n=5) | -0.601 (5 pairs) |
| `sfMaxEndA` | 2.436 [2.256–2.684] (n=5) | 1.900 [1.900–1.900] (n=5) | -0.556 (5 pairs) |
| `capacityLoss` | 0.010 [0.010–0.010] (n=5) | 0.010 [0.010–0.010] (n=5) | 0.000 (5 pairs) |
| `coordLoss` | 0.087 [0.078–0.089] (n=5) | 0.003 [0.002–0.003] (n=5) | -0.084 (5 pairs) |
| `tRec` | censored ×5 | 5.250 [5.250–5.500] (n=5) | — |
| `npwcDeficitSec` | 4.836 [4.322–4.928] (n=5) | 0.821 [0.734–0.846] (n=5) | -4.131 (5 pairs) |
| `slotChanges` | 0 [0–0] (n=5) | 25 [25–28] (n=5) | 25 (5 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=5) | 2 [1–2] (n=5) | 2 (5 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `collisions` | 14 [14–14] (n=5) | 17 [17–18] (n=5) | 4 (5 pairs) |
| `nearMisses` | 239 [233–239] (n=5) | 253 [251–254] (n=5) | 17 (5 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=5) | 4.000 [4.000–4.000] (n=5) | 4.000 (5 pairs) |
| `deliveryRatio` | n/a ×5 | 0.950 [0.950–0.950] (n=5) | — |
| `adoptP50` | n/a ×5 | n/a ×5 | — |
| `adoptMax` | n/a ×5 | n/a ×5 | — |
| `unadopted` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `splitSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `tVersion` | n/a ×5 | n/a ×5 | — |

### S2 (n0 = 200)

Seeds: static 5, encore 5, fair pairs 5, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.909 | 0.989 | 0.080 | WIN |
| 2 | 0.926 | 0.997 | 0.071 | WIN |
| 3 | 0.909 | 0.989 | 0.080 | WIN |
| 4 | 0.899 | 0.997 | 0.097 | WIN |
| 5 | 0.916 | 0.997 | 0.081 | WIN |

Win/tie/loss: **5 / 0 / 0** of 5 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 2, Δ 0.071.
tRec censored (not recovered): static 5 of 5, encore 0 of 5.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.909 [0.909–0.916] (n=5) | 0.997 [0.989–0.997] (n=5) | 0.080 (5 pairs) |
| `npwcEndA` | 0.909 [0.909–0.916] (n=5) | 0.969 [0.960–0.969] (n=5) | 0.059 (5 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=5) | 0.900 [0.900–0.900] (n=5) | 0.000 (5 pairs) |
| `sfMeanEnd` | 1.015 [1.009–1.025] (n=5) | 0.980 [0.980–0.985] (n=5) | -0.034 (5 pairs) |
| `sfMaxEnd` | 2.803 [2.749–3.108] (n=5) | 2.084 [2.024–2.204] (n=5) | -0.779 (5 pairs) |
| `sfMaxEndA` | 7.034 [6.525–8.437] (n=5) | 2.393 [2.184–2.393] (n=5) | -4.641 (5 pairs) |
| `capacityLoss` | 0.010 [0.010–0.010] (n=5) | 0.010 [0.010–0.010] (n=5) | 0.000 (5 pairs) |
| `coordLoss` | 0.090 [0.083–0.090] (n=5) | 0.003 [0.003–0.011] (n=5) | -0.079 (5 pairs) |
| `tRec` | censored ×5 | 9.250 [9.250–9.500] (n=5) | — |
| `npwcDeficitSec` | 5.008 [4.599–5.008] (n=5) | 1.759 [1.673–1.759] (n=5) | -3.249 (5 pairs) |
| `slotChanges` | 0 [0–0] (n=5) | 33 [30–33] (n=5) | 33 (5 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=5) | 2 [2–2] (n=5) | 2 (5 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `collisions` | 14 [12–14] (n=5) | 16 [16–16] (n=5) | 3 (5 pairs) |
| `nearMisses` | 242 [240–242] (n=5) | 254 [251–257] (n=5) | 14 (5 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=5) | 4.000 [4.000–4.000] (n=5) | 4.000 (5 pairs) |
| `deliveryRatio` | n/a ×5 | 0.950 [0.950–0.950] (n=5) | — |
| `adoptP50` | n/a ×5 | n/a ×5 | — |
| `adoptMax` | n/a ×5 | n/a ×5 | — |
| `unadopted` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `splitSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `tVersion` | n/a ×5 | n/a ×5 | — |

### S3 (n0 = 200)

Seeds: static 5, encore 5, fair pairs 5, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 1.000 | 1.000 | 0 | TIE |
| 2 | 1.000 | 1.000 | 0 | TIE |
| 3 | 1.000 | 1.000 | 0 | TIE |
| 4 | 1.000 | 1.000 | 0 | TIE |
| 5 | 1.000 | 1.000 | 0 | TIE |

Win/tie/loss: **0 / 5 / 0** of 5 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.
tRec censored (not recovered): static n/a (no KILL), encore n/a (no KILL).

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 1.000 [1.000–1.000] (n=5) | 1.000 [1.000–1.000] (n=5) | 0.000 (5 pairs) |
| `npwcEndA` | 1.000 [1.000–1.000] (n=5) | 1.000 [1.000–1.000] (n=5) | 0.000 (5 pairs) |
| `coverageEnd` | 1 [1–1] (n=5) | 1 [1–1] (n=5) | 0 (5 pairs) |
| `sfMeanEnd` | 0.935 [0.935–0.935] (n=5) | 0.935 [0.935–0.935] (n=5) | 0.000 (5 pairs) |
| `sfMaxEnd` | 1.972 [1.972–1.972] (n=5) | 1.972 [1.972–1.972] (n=5) | 0.000 (5 pairs) |
| `sfMaxEndA` | 1.598 [1.598–1.598] (n=5) | 1.598 [1.598–1.598] (n=5) | 0.000 (5 pairs) |
| `capacityLoss` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `coordLoss` | 0.000 [0.000–0.000] (n=5) | 0.000 [0.000–0.000] (n=5) | 0.000 (5 pairs) |
| `npwcDeficitSec` | 0.000 [0.000–0.000] (n=5) | 0.000 [0.000–0.000] (n=5) | 0.000 (5 pairs) |
| `slotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `collisions` | 14 [14–14] (n=5) | 14 [14–14] (n=5) | 0 (5 pairs) |
| `nearMisses` | 250 [250–250] (n=5) | 250 [250–250] (n=5) | 0 (5 pairs) |
| `msgsPerDroneSec` | 0 [0–0] (n=5) | 4 [4–4] (n=5) | 4 (5 pairs) |
| `deliveryRatio` | n/a ×5 | 0.732 [0.732–0.732] (n=5) | — |
| `adoptP50` | n/a ×5 | n/a ×5 | — |
| `adoptMax` | n/a ×5 | n/a ×5 | — |
| `unadopted` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `splitSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `tVersion` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |

### S5 (n0 = 200)

Seeds: static 5, encore 5, fair pairs 5, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed (no win/tie/loss: static cannot adopt an injected score (capability difference, see `unadopted`)):

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 1.000 | 1.000 | 0 | n/a |
| 2 | 1.000 | 1.000 | 0 | n/a |
| 3 | 1.000 | 1.000 | 0 | n/a |
| 4 | 1.000 | 1.000 | 0 | n/a |
| 5 | 1.000 | 1.000 | 0 | n/a |

Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.
tRec censored (not recovered): static n/a (no KILL), encore n/a (no KILL).

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 1.000 [1.000–1.000] (n=5) | 1.000 [1.000–1.000] (n=5) | 0.000 (5 pairs) |
| `npwcEndA` | 1.000 [1.000–1.000] (n=5) | n/a ×5 | — |
| `coverageEnd` | 1 [1–1] (n=5) | 1 [1–1] (n=5) | 0 (5 pairs) |
| `sfMeanEnd` | 0.935 [0.935–0.935] (n=5) | 0.790 [0.790–0.790] (n=5) | -0.145 (5 pairs) |
| `sfMaxEnd` | 1.972 [1.972–1.972] (n=5) | 1.743 [1.743–1.743] (n=5) | -0.228 (5 pairs) |
| `sfMaxEndA` | 1.598 [1.598–1.598] (n=5) | n/a ×5 | — |
| `capacityLoss` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `coordLoss` | 0.000 [0.000–0.000] (n=5) | 0.000 [0.000–0.000] (n=5) | 0.000 (5 pairs) |
| `npwcDeficitSec` | 0.000 [0.000–0.000] (n=5) | 0.000 [0.000–0.002] (n=5) | 0.000 (5 pairs) |
| `slotChanges` | 0 [0–0] (n=5) | 6 [6–6] (n=5) | 6 (5 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=5) | 2 [2–2] (n=5) | 2 (5 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotSec` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=5) | 0 [0–0] (n=5) | 0 (5 pairs) |
| `collisions` | 14 [14–14] (n=5) | 103 [101–103] (n=5) | 89 (5 pairs) |
| `nearMisses` | 250 [250–250] (n=5) | 809 [801–813] (n=5) | 559 (5 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=5) | 4.016 [4.016–4.017] (n=5) | 4.016 (5 pairs) |
| `deliveryRatio` | n/a ×5 | 0.931 [0.931–0.931] (n=5) | — |
| `adoptP50` | n/a ×5 | 0.800 [0.700–0.850] (n=5) | — |
| `adoptMax` | n/a ×5 | 15.400 [15.350–15.450] (n=5) | — |
| `unadopted` | 200 [200–200] (n=5) | 0 [0–0] (n=5) | -200 (5 pairs) |
| `splitSec` | 0.000 [0.000–0.000] (n=5) | 15.400 [15.350–15.450] (n=5) | 15.400 (5 pairs) |
| `tVersion` | 0.000 [0.000–0.000] (n=5) | 0.400 [0.350–0.450] (n=5) | 0.400 (5 pairs) |

---

## Notes (written by hand, not generated from the records above)

Everything above this line is the unedited output of `npm run eval -- --report results`. This section adds how the run was made and checks that need more than the summary statistics. Each line says where its number comes from.

### Provenance

- **Commit:** `0b2f8f3c7c57f1f3d34adf99a1748ab20baae973` (`main`, CI green), the evidence freeze. Like the previous freeze at `571c8e4`, it includes #96 (paced targets), #105 (score gossip), #107 (Encore brain in the app), #116 (Encore arm in the CLI), #118, #119 and #120. Since `571c8e4` the simulation core has gained:
  - #82 (sensed drones passed in geometric order, issue #64);
  - #115 (a faster Encore step and observer; its PR reports identical behaviour, but see Superseded);
  - #156 and #163 (SpatialGrid fixes).

  The CLI has gained #153 (seed checks).
- **Params:** frozen in [PARAMS.md](PARAMS.md), `paramsHash` `6342c662955320742188728c5ff096dbc1ef6afb0117fc2f04194b71c18091f2`, unchanged since `571c8e4`. All 50 records carry this git and paramsHash; checked after the run.
- **Matrix:** S0, S1, S2, S3 and S5, seeds 1–5, both arms, n0 = 200, 1800 ticks each: 50 records. This is the minimum matrix of evaluation doc §5. The full matrix was run at the same commit: S0–S5 × seeds 1–20 at n0 = 200 (240 records, [full/n200/RESULTS.md](full/n200/RESULTS.md)) and S1, S2 × seeds 1–20 at n0 = 100 (80 records, paramsHash `a3b556548345` in [full/n100/PARAMS.md](full/n100/PARAMS.md), [full/n100/RESULTS.md](full/n100/RESULTS.md)). Its seeds 1–5 at n0 = 200 equal the records here. **Not run:** S0 at n0 = 100.
- **Run:** `FREEZE_FULL=1 FREEZE_JOBS=3 bash scripts/eval/freeze-run.sh`, with at most 3 processes.
  - The minimum matrix runs one job per scenario, each `npm run eval -- --scenario Sx --seeds 1-5 --arms static,encore --n0 200 --out <staging dir>`. It is moved into `results/` after the replay check.
  - The full matrix runs two jobs per scenario (seeds 1–10 and 11–20).
  - Run notes from the author (records hold no wall-clock): wall-clock 142 s in total for the minimum matrix. Per scenario (10 runs each): S0 76 s, S1 68 s, S2 69 s, S3 74 s, S5 67 s. The full matrix then took 657 s.
  - Load average (`/proc/loadavg`, 1/5/15 min, 16 cores, shared with other sessions): 5.05 / 2.87 / 3.75 before, 3.53 / 3.12 / 3.73 after.
- **Replay:** one Encore record per scenario (seed 3) was re-run from the same commit into a scratch directory. The `stateHash`, `summary` and `series` were identical for all 5 (S0 `01b1d16ddb1198b9`, S1 `0e17250d281c9b91`, S2 `a243a6f6b5b37ee2`, S3 `0ff323014b6690cd`, S5 `6fddd85f3b49d33b`).
- **Superseded:** [superseded-571c8e4/](superseded-571c8e4/RESULTS.md) keeps the `571c8e4` records and PARAMS.md, and the RESULTS.md that described them (as on `main` at `0b2f8f3`, with a SUPERSEDED banner added).
  - 9 of the 50 records are identical apart from `git`.
  - 14 differ in `stateHash`. Most likely #82 caused this, by changing the order in which sensed drones are passed. Its PR says seeded runs then differ in the last bits, and #156 and #163 report no `stateHash` change.
  - 38 differ in the last float digits of `series[].sfMean` or `sfMax`; the largest relative difference is 3e-14.
    - 11 of the 38 also differ in `stateHash`. The other 27 have an unchanged `stateHash`, so their world is the same and the noise comes from the observer, which #115 rewrote.
    - The noise reaches `summary.sfMeanEnd` in 3 S5 Encore records.
  - No other field differs, and the generated tables above are identical to the old ones apart from the Records/git line.

### Pre-registered pass lines (evaluation doc §3), scaled to 5 seeds, checked per seed from the records

| ID | Pass line | Result |
|---|---|---|
| S0 | Encore `slotChanges = 0` and both arms `npwcEnd ≥ 0.98` | 5 of 5 |
| S1 | Δ ≥ −0.02, `lateSlotChanges = 0`, `dupSlotsEnd = 0`, `slotChanges ≤ 60` | 5 of 5 (Encore `slotChanges` 21–29) |
| S2 | win; `sfMaxEndA` below static; median `tRec ≤ 20 s`, at most 5 of 20 censored (scaled: ≤ 1) | win 5 of 5 (4 distinct kill sets: seeds 1 and 3 kill the same 20 drones); `sfMaxEndA` below static 5 of 5 (Encore 2.16–2.39 m vs static 6.52–8.58 m); median Encore `tRec` 9.25 s (5.50–9.75 s, flight time included); Encore censored 0 of 5 (static 5 of 5) |
| S3 | Encore `slotChanges = 0` and tie | 5 of 5 |
| S5 | ≥ 99% of d's partition group adopt by tick 600; no drone of the other group adopts before `PARTITION_OFF` (700); one version at the end; median `tVersion ≤ 10 s`; `dupSlotsEnd = 0` | met on 5 of 5. The records give holder counts only, so group membership and per-group adoption come from a separate script at `571c8e4` (below) |

Distinct inputs (evaluation doc §5):
- S0, S3 and S5 events do not depend on the seed, so static has one distinct outcome and Encore varies only through seeded randomness.
- S1 draws 5 distinct kill sets.
- S2 draws 4 (seeds 1 and 3 kill the same drones).

**S5 detail.** The record stores no `partitionSide`, so the size of drone d's group was measured separately. A script built the same S5 world (same seed, params, score and events) and read `partitionSide` from the tick-301 snapshot: drone 1 is in group 0, which has **103 of 200** drones on every seed. That script ran at `571c8e4` and was not re-run here. The five S5 Encore records changed `stateHash` with #82, but every series field, `versions` included, matches the `571c8e4` records up to float noise. The records here still show exactly 103 holders at every sample from tick 600 to 700 on every seed, which is consistent with that group size. Then, from each record's `series[].versions`, the injected version `400:1`:
- is held by 1 drone at tick 405 and by 103 at tick 600;
- stays at 103 for every sample from 600 to 700;
- first exceeds 103 in the tick-705 sample, after `PARTITION_OFF` (samples are every 5 ticks);
- is held by all 200 at tick 1800.

`tVersion` per seed is 0.30–0.45 s and `dupSlotsEnd` is 0.

### Where Encore ties or costs more (read with the tables above)

- **Ties:** S0 and S3 tie on `npwcEnd` on every seed (0 / 5 / 0). S5 has no win/tie/loss by design. There are **no LOSS rows** in this run.
- **Collisions and near-misses, Encore ≥ static** (with paced targets):

  | Scenario | Collisions (static vs Encore median) | Near-misses (static vs Encore median) |
  |---|---|---|
  | S0 | 14 vs 14 | 250 vs 250 |
  | S1 | 14 vs 17 (paired Δ +4) | 239 vs 253 |
  | S2 | 14 vs 16 (Δ +3) | 242 vs 254 |
  | S3 | 14 vs 14 | 250 vs 250 |
  | **S5** | **14 vs 103 (Δ +89)** | **250 vs 809** |

  - The S5 cost is large and stays. [#123](https://github.com/durhacko/Pihh/issues/123) measured adoption-pacing variants and decided to merge none (PR #129 closed unmerged), so the cost is reported, not fixed.
  - Diagnosed in #123 after the previous freeze. That diagnosis used commit `571c8e4`, all 5 seeds and snapshot ground truth, not these records.
    - At this commit the S5 Encore `stateHash` differs on all 5 seeds (#82).
    - Unchanged: the per-seed totals (98–106; 95–110 over 20 seeds in [full/n200](full/n200/RESULTS.md)), the per-window counts from `series[].collisions` (11 before tick 460, 8 in ticks 460–699, 79–87 in 700–899, 0 from 900), and the last adoption ticks (706–709, from `adoptMax`).
    - The group split and the closing speeds below were measured at `571c8e4` only.
  - The diagnosis found: 79-87 of Encore's 98-106 collisions per seed happen in ticks 700-899, right after reconnection, and nearly all involve group 1. Group 1 adopts the injected score at ticks 703-709, when its BRAVO paced target is already about 61% of the way along, and the median closing speed of those collisions is 7.6-7.9 m/s (about `vMax`). That compares with 2.5 m/s for the 8 paced collisions in ticks 460-699 on seed 1. Every seed has 8 collisions in that window, but #123 measured their closing speed on seed 1 only.
  - The S5 collision row is also not like-for-like: Encore's drones fly ENCORE→BRAVO from tick 460, while static flies its preloaded formation change.
  - Collision and near-miss counts are lower bounds: contacts are sampled at 20 Hz (evaluation doc §8).
- **Radio:** Encore sends 4.0 messages per drone per second (4.016 in S5, with `SCORE` gossip); static sends none. Delivery ratio is 0.950 (S0–S2), 0.732 (S3, partition and jam) and 0.931 (S5).
- **Slot changes:** Encore medians 25 (S1, 21-29 across seeds), 33 (S2) and 6 (S5) per run, at most 2 per drone; static 0.
- **S5 shape metrics compare different formations:** each world is measured against the newest score one of its own live drones believes (contract §5). At the end the Encore arm flies the injected BRAVO and static flies the preloaded sphere, so the S5 deltas of `sfMeanEnd`, `sfMaxEnd`, `npwcEnd` and `coverageEnd` (table and per-seed rows) are not like-for-like. Encore's `npwcEndA` and `sfMaxEndA` are `n/a` because its reference formation has no hold samples in ticks 800–899.
- **Our own labels:** the `npwc` wins in S1 and S2 are priority-weighted by our own slot order. `coverageEnd` ties at 0.900 in both; by physics it cannot favour Encore, since both arms lose the same drones (evaluation doc §8).

### G1 beyond-gate sweep at this commit (sourced, not from these records)

`npx vitest run tests/g1/g1.beyond.test.ts` at `0b2f8f3` prints the same two lines as at `571c8e4`:

```text
  all five conditions: 38 of 40 runs. Per condition: dup<=3s 40, quiet last 10 s 38, commits<=3xkills 40, commits lower 40, npwc>static 40
  time from the kill to the last commit, s: median 7.68, max 20.20 (the quiet condition allows 20.00)
```

So, with paced targets, 38 of the 40 kill centres are quiet in the last 10 s. 2 centres (15 and 30) still commit late, both 20.20 s after the kill, 0.20 s past the 20.00 s the quiet condition allows. The titles of the known-miss test and of the bound test beside it record the same figures (38 of 40; 2 late centres, latest 20.20 s).
