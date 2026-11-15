# Evaluation results

Records: 240. git: `0b2f8f3c7c57f1f3d34adf99a1748ab20baae973`. paramsHash: `6342c6629553`.

Medians and IQRs skip null values, counted separately: `n/a` = not applicable (e.g. `npwcDeficitSec` with no event), `—` = key absent (e.g. `tRec` without a KILL). Exception: a censored `tRec` (not recovered) ranks above every recovered seed, and a quantile that lands on one prints `censored`. Deltas and win/tie/loss use fair pairs only (same git, paramsHash and events); other pairs are listed as MISMATCH. `npwc` is priority-weighted by our own slot order: read it beside `coverage`, `sfMean` and `sfMax`.

### S0 (n0 = 200)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 1.000 | 1.000 | 0 | TIE |
| 2 | 1.000 | 1.000 | 0 | TIE |
| 3 | 1.000 | 1.000 | 0 | TIE |
| 4 | 1.000 | 1.000 | 0 | TIE |
| 5 | 1.000 | 1.000 | 0 | TIE |
| 6 | 1.000 | 1.000 | 0 | TIE |
| 7 | 1.000 | 1.000 | 0 | TIE |
| 8 | 1.000 | 1.000 | 0 | TIE |
| 9 | 1.000 | 1.000 | 0 | TIE |
| 10 | 1.000 | 1.000 | 0 | TIE |
| 11 | 1.000 | 1.000 | 0 | TIE |
| 12 | 1.000 | 1.000 | 0 | TIE |
| 13 | 1.000 | 1.000 | 0 | TIE |
| 14 | 1.000 | 1.000 | 0 | TIE |
| 15 | 1.000 | 1.000 | 0 | TIE |
| 16 | 1.000 | 1.000 | 0 | TIE |
| 17 | 1.000 | 1.000 | 0 | TIE |
| 18 | 1.000 | 1.000 | 0 | TIE |
| 19 | 1.000 | 1.000 | 0 | TIE |
| 20 | 1.000 | 1.000 | 0 | TIE |

Win/tie/loss: **0 / 20 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.
tRec censored (not recovered): static n/a (no KILL), encore n/a (no KILL).

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 1.000 [1.000–1.000] (n=20) | 1.000 [1.000–1.000] (n=20) | 0.000 (20 pairs) |
| `npwcEndA` | 1.000 [1.000–1.000] (n=20) | 1.000 [1.000–1.000] (n=20) | 0.000 (20 pairs) |
| `coverageEnd` | 1 [1–1] (n=20) | 1 [1–1] (n=20) | 0 (20 pairs) |
| `sfMeanEnd` | 0.935 [0.935–0.935] (n=20) | 0.935 [0.935–0.935] (n=20) | 0.000 (20 pairs) |
| `sfMaxEnd` | 1.972 [1.972–1.972] (n=20) | 1.972 [1.972–1.972] (n=20) | 0.000 (20 pairs) |
| `sfMaxEndA` | 1.598 [1.598–1.598] (n=20) | 1.598 [1.598–1.598] (n=20) | 0.000 (20 pairs) |
| `capacityLoss` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `coordLoss` | 0.000 [0.000–0.000] (n=20) | 0.000 [0.000–0.000] (n=20) | 0.000 (20 pairs) |
| `npwcDeficitSec` | n/a ×20 | n/a ×20 | — |
| `slotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 14 [14–14] (n=20) | 14 [14–14] (n=20) | 0 (20 pairs) |
| `nearMisses` | 250 [250–250] (n=20) | 250 [250–250] (n=20) | 0 (20 pairs) |
| `msgsPerDroneSec` | 0 [0–0] (n=20) | 4 [4–4] (n=20) | 4 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.950 [0.950–0.950] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | n/a ×20 | n/a ×20 | — |

### S1 (n0 = 200)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.927 | 0.998 | 0.071 | WIN |
| 2 | 0.905 | 0.995 | 0.090 | WIN |
| 3 | 0.910 | 0.997 | 0.087 | WIN |
| 4 | 0.912 | 0.997 | 0.085 | WIN |
| 5 | 0.921 | 0.999 | 0.077 | WIN |
| 6 | 0.906 | 0.997 | 0.091 | WIN |
| 7 | 0.894 | 0.998 | 0.104 | WIN |
| 8 | 0.930 | 0.997 | 0.067 | WIN |
| 9 | 0.924 | 0.998 | 0.074 | WIN |
| 10 | 0.919 | 0.998 | 0.079 | WIN |
| 11 | 0.917 | 0.999 | 0.082 | WIN |
| 12 | 0.907 | 0.999 | 0.092 | WIN |
| 13 | 0.901 | 0.998 | 0.097 | WIN |
| 14 | 0.914 | 0.998 | 0.083 | WIN |
| 15 | 0.910 | 0.997 | 0.087 | WIN |
| 16 | 0.907 | 0.998 | 0.090 | WIN |
| 17 | 0.895 | 0.998 | 0.103 | WIN |
| 18 | 0.923 | 0.998 | 0.075 | WIN |
| 19 | 0.916 | 0.997 | 0.081 | WIN |
| 20 | 0.909 | 0.994 | 0.086 | WIN |

Win/tie/loss: **20 / 0 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 8, Δ 0.067.
tRec censored (not recovered): static 20 of 20, encore 0 of 20.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.911 [0.907–0.920] (n=20) | 0.998 [0.997–0.998] (n=20) | 0.085 (20 pairs) |
| `npwcEndA` | 0.911 [0.907–0.920] (n=20) | 0.992 [0.989–0.994] (n=20) | 0.082 (20 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=20) | 0.900 [0.900–0.900] (n=20) | 0.000 (20 pairs) |
| `sfMeanEnd` | 1.013 [1.008–1.017] (n=20) | 0.977 [0.977–0.978] (n=20) | -0.036 (20 pairs) |
| `sfMaxEnd` | 2.714 [2.651–2.765] (n=20) | 2.024 [1.985–2.039] (n=20) | -0.652 (20 pairs) |
| `sfMaxEndA` | 2.256 [2.256–2.902] (n=20) | 1.900 [1.900–1.900] (n=20) | -0.546 (20 pairs) |
| `capacityLoss` | 0.010 [0.010–0.010] (n=20) | 0.010 [0.010–0.010] (n=20) | 0.000 (20 pairs) |
| `coordLoss` | 0.088 [0.079–0.092] (n=20) | 0.002 [0.002–0.003] (n=20) | -0.084 (20 pairs) |
| `tRec` | censored ×20 | 5.250 [5.250–5.313] (n=20) | — |
| `npwcDeficitSec` | 4.882 [4.407–5.131] (n=20) | 0.750 [0.700–0.828] (n=20) | -4.126 (20 pairs) |
| `slotChanges` | 0 [0–0] (n=20) | 25 [23–27] (n=20) | 25 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 2 [1–2] (n=20) | 2 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 14.000 [13.750–14.000] (n=20) | 17.000 [16.000–18.250] (n=20) | 3.000 (20 pairs) |
| `nearMisses` | 237.500 [235.500–241.000] (n=20) | 253.000 [251.000–254.250] (n=20) | 15.500 (20 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=20) | 4.000 [4.000–4.000] (n=20) | 4.000 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.950 [0.950–0.950] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | n/a ×20 | n/a ×20 | — |

### S2 (n0 = 200)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.909 | 0.989 | 0.080 | WIN |
| 2 | 0.926 | 0.997 | 0.071 | WIN |
| 3 | 0.909 | 0.989 | 0.080 | WIN |
| 4 | 0.899 | 0.997 | 0.097 | WIN |
| 5 | 0.916 | 0.997 | 0.081 | WIN |
| 6 | 0.916 | 0.996 | 0.081 | WIN |
| 7 | 0.919 | 0.997 | 0.078 | WIN |
| 8 | 0.908 | 0.992 | 0.084 | WIN |
| 9 | 0.912 | 0.997 | 0.085 | WIN |
| 10 | 0.901 | 0.998 | 0.097 | WIN |
| 11 | 0.918 | 0.995 | 0.078 | WIN |
| 12 | 0.918 | 0.996 | 0.078 | WIN |
| 13 | 0.918 | 0.996 | 0.078 | WIN |
| 14 | 0.925 | 0.997 | 0.072 | WIN |
| 15 | 0.911 | 0.993 | 0.081 | WIN |
| 16 | 0.911 | 0.998 | 0.087 | WIN |
| 17 | 0.888 | 0.997 | 0.108 | WIN |
| 18 | 0.900 | 0.996 | 0.096 | WIN |
| 19 | 0.932 | 0.998 | 0.066 | WIN |
| 20 | 0.903 | 0.992 | 0.089 | WIN |

Win/tie/loss: **20 / 0 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 19, Δ 0.066.
tRec censored (not recovered): static 20 of 20, encore 0 of 20.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.912 [0.907–0.918] (n=20) | 0.996 [0.995–0.997] (n=20) | 0.081 (20 pairs) |
| `npwcEndA` | 0.912 [0.907–0.918] (n=20) | 0.961 [0.959–0.969] (n=20) | 0.053 (20 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=20) | 0.900 [0.900–0.900] (n=20) | 0.000 (20 pairs) |
| `sfMeanEnd` | 1.013 [1.004–1.019] (n=20) | 0.979 [0.979–0.980] (n=20) | -0.033 (20 pairs) |
| `sfMaxEnd` | 2.749 [2.576–2.841] (n=20) | 2.084 [2.024–2.114] (n=20) | -0.713 (20 pairs) |
| `sfMaxEndA` | 7.603 [6.804–8.472] (n=20) | 2.393 [2.238–2.802] (n=20) | -4.876 (20 pairs) |
| `capacityLoss` | 0.010 [0.010–0.010] (n=20) | 0.010 [0.010–0.010] (n=20) | 0.000 (20 pairs) |
| `coordLoss` | 0.087 [0.081–0.092] (n=20) | 0.004 [0.003–0.005] (n=20) | -0.080 (20 pairs) |
| `tRec` | censored ×20 | 9.375 [9.250–14.250] (n=20) | — |
| `npwcDeficitSec` | 4.846 [4.513–5.132] (n=20) | 1.684 [1.608–1.879] (n=20) | -3.101 (20 pairs) |
| `slotChanges` | 0.000 [0.000–0.000] (n=20) | 31.000 [28.750–33.000] (n=20) | 31.000 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 2 [2–2] (n=20) | 2 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 14 [13–14] (n=20) | 16 [16–18] (n=20) | 4 (20 pairs) |
| `nearMisses` | 241.000 [240.000–242.000] (n=20) | 253.000 [249.000–254.250] (n=20) | 11.500 (20 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=20) | 4.000 [4.000–4.000] (n=20) | 4.000 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.950 [0.950–0.950] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | n/a ×20 | n/a ×20 | — |

### S3 (n0 = 200)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 1.000 | 1.000 | 0 | TIE |
| 2 | 1.000 | 1.000 | 0 | TIE |
| 3 | 1.000 | 1.000 | 0 | TIE |
| 4 | 1.000 | 1.000 | 0 | TIE |
| 5 | 1.000 | 1.000 | 0 | TIE |
| 6 | 1.000 | 1.000 | 0 | TIE |
| 7 | 1.000 | 1.000 | 0 | TIE |
| 8 | 1.000 | 1.000 | 0 | TIE |
| 9 | 1.000 | 1.000 | 0 | TIE |
| 10 | 1.000 | 1.000 | 0 | TIE |
| 11 | 1.000 | 1.000 | 0 | TIE |
| 12 | 1.000 | 1.000 | 0 | TIE |
| 13 | 1.000 | 1.000 | 0 | TIE |
| 14 | 1.000 | 1.000 | 0 | TIE |
| 15 | 1.000 | 1.000 | 0 | TIE |
| 16 | 1.000 | 1.000 | 0 | TIE |
| 17 | 1.000 | 1.000 | 0 | TIE |
| 18 | 1.000 | 1.000 | 0 | TIE |
| 19 | 1.000 | 1.000 | 0 | TIE |
| 20 | 1.000 | 1.000 | 0 | TIE |

Win/tie/loss: **0 / 20 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.
tRec censored (not recovered): static n/a (no KILL), encore n/a (no KILL).

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 1.000 [1.000–1.000] (n=20) | 1.000 [1.000–1.000] (n=20) | 0.000 (20 pairs) |
| `npwcEndA` | 1.000 [1.000–1.000] (n=20) | 1.000 [1.000–1.000] (n=20) | 0.000 (20 pairs) |
| `coverageEnd` | 1 [1–1] (n=20) | 1 [1–1] (n=20) | 0 (20 pairs) |
| `sfMeanEnd` | 0.935 [0.935–0.935] (n=20) | 0.935 [0.935–0.935] (n=20) | 0.000 (20 pairs) |
| `sfMaxEnd` | 1.972 [1.972–1.972] (n=20) | 1.972 [1.972–1.972] (n=20) | 0.000 (20 pairs) |
| `sfMaxEndA` | 1.598 [1.598–1.598] (n=20) | 1.598 [1.598–1.598] (n=20) | 0.000 (20 pairs) |
| `capacityLoss` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `coordLoss` | 0.000 [0.000–0.000] (n=20) | 0.000 [0.000–0.000] (n=20) | 0.000 (20 pairs) |
| `npwcDeficitSec` | 0.000 [0.000–0.000] (n=20) | 0.000 [0.000–0.000] (n=20) | 0.000 (20 pairs) |
| `slotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 14 [14–14] (n=20) | 14 [14–14] (n=20) | 0 (20 pairs) |
| `nearMisses` | 250 [250–250] (n=20) | 250 [250–250] (n=20) | 0 (20 pairs) |
| `msgsPerDroneSec` | 0 [0–0] (n=20) | 4 [4–4] (n=20) | 4 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.732 [0.732–0.732] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |

### S4 (n0 = 200)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.901 | 0.994 | 0.093 | WIN |
| 2 | 0.898 | 0.994 | 0.095 | WIN |
| 3 | 0.905 | 0.995 | 0.090 | WIN |
| 4 | 0.915 | 0.996 | 0.082 | WIN |
| 5 | 0.891 | 0.997 | 0.106 | WIN |
| 6 | 0.912 | 0.994 | 0.082 | WIN |
| 7 | 0.901 | 0.996 | 0.096 | WIN |
| 8 | 0.915 | 0.996 | 0.082 | WIN |
| 9 | 0.901 | 0.996 | 0.096 | WIN |
| 10 | 0.901 | 0.996 | 0.096 | WIN |
| 11 | 0.912 | 0.994 | 0.082 | WIN |
| 12 | 0.916 | 0.993 | 0.078 | WIN |
| 13 | 0.910 | 0.993 | 0.083 | WIN |
| 14 | 0.901 | 0.996 | 0.096 | WIN |
| 15 | 0.901 | 0.996 | 0.095 | WIN |
| 16 | 0.912 | 0.994 | 0.082 | WIN |
| 17 | 0.913 | 0.994 | 0.081 | WIN |
| 18 | 0.901 | 0.994 | 0.093 | WIN |
| 19 | 0.913 | 0.994 | 0.081 | WIN |
| 20 | 0.898 | 0.994 | 0.095 | WIN |

Win/tie/loss: **20 / 0 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 12, Δ 0.078.
tRec censored (not recovered): static 20 of 20, encore 0 of 20.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.903 [0.901–0.912] (n=20) | 0.994 [0.994–0.996] (n=20) | 0.092 (20 pairs) |
| `npwcEndA` | 0.903 [0.901–0.912] (n=20) | 0.961 [0.959–0.961] (n=20) | 0.056 (20 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=20) | 0.900 [0.900–0.900] (n=20) | 0.000 (20 pairs) |
| `sfMeanEnd` | 1.015 [1.011–1.019] (n=20) | 0.981 [0.980–0.982] (n=20) | -0.032 (20 pairs) |
| `sfMaxEnd` | 2.758 [2.758–2.787] (n=20) | 2.204 [2.069–2.204] (n=20) | -0.553 (20 pairs) |
| `sfMaxEndA` | 9.235 [8.925–9.555] (n=20) | 2.994 [2.626–3.509] (n=20) | -6.067 (20 pairs) |
| `capacityLoss` | 0.010 [0.010–0.010] (n=20) | 0.010 [0.010–0.010] (n=20) | 0.000 (20 pairs) |
| `coordLoss` | 0.096 [0.087–0.098] (n=20) | 0.006 [0.004–0.006] (n=20) | -0.091 (20 pairs) |
| `tRec` | censored ×20 | 18.250 [16.438–18.250] (n=20) | — |
| `npwcDeficitSec` | 5.337 [4.830–5.470] (n=20) | 1.934 [1.886–1.977] (n=20) | -3.375 (20 pairs) |
| `slotChanges` | 0.000 [0.000–0.000] (n=20) | 39.000 [36.750–41.000] (n=20) | 39.000 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 3 [3–3] (n=20) | 3 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0.000 [0.000–0.000] (n=20) | 6.625 [2.000–13.500] (n=20) | 6.625 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 14 [13–14] (n=20) | 19 [17–20] (n=20) | 5 (20 pairs) |
| `nearMisses` | 239.500 [237.750–240.000] (n=20) | 255.500 [254.750–257.250] (n=20) | 18.000 (20 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=20) | 4.000 [4.000–4.000] (n=20) | 4.000 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.946 [0.946–0.947] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |

### S5 (n0 = 200)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed (no win/tie/loss: static cannot adopt an injected score (capability difference, see `unadopted`)):

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 1.000 | 1.000 | 0 | n/a |
| 2 | 1.000 | 1.000 | 0 | n/a |
| 3 | 1.000 | 1.000 | 0 | n/a |
| 4 | 1.000 | 1.000 | 0 | n/a |
| 5 | 1.000 | 1.000 | 0 | n/a |
| 6 | 1.000 | 1.000 | 0 | n/a |
| 7 | 1.000 | 1.000 | 0 | n/a |
| 8 | 1.000 | 1.000 | 0 | n/a |
| 9 | 1.000 | 1.000 | 0 | n/a |
| 10 | 1.000 | 1.000 | 0 | n/a |
| 11 | 1.000 | 1.000 | 0 | n/a |
| 12 | 1.000 | 1.000 | 0 | n/a |
| 13 | 1.000 | 1.000 | 0 | n/a |
| 14 | 1.000 | 1.000 | 0 | n/a |
| 15 | 1.000 | 1.000 | 0 | n/a |
| 16 | 1.000 | 1.000 | 0 | n/a |
| 17 | 1.000 | 1.000 | 0 | n/a |
| 18 | 1.000 | 1.000 | 0 | n/a |
| 19 | 1.000 | 1.000 | 0 | n/a |
| 20 | 1.000 | 1.000 | 0 | n/a |

Worst seed (lowest Δ npwcEnd): seed 1, Δ 0.
tRec censored (not recovered): static n/a (no KILL), encore n/a (no KILL).

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 1.000 [1.000–1.000] (n=20) | 1.000 [1.000–1.000] (n=20) | 0.000 (20 pairs) |
| `npwcEndA` | 1.000 [1.000–1.000] (n=20) | n/a ×20 | — |
| `coverageEnd` | 1 [1–1] (n=20) | 1 [1–1] (n=20) | 0 (20 pairs) |
| `sfMeanEnd` | 0.935 [0.935–0.935] (n=20) | 0.790 [0.790–0.790] (n=20) | -0.145 (20 pairs) |
| `sfMaxEnd` | 1.972 [1.972–1.972] (n=20) | 1.743 [1.743–1.743] (n=20) | -0.228 (20 pairs) |
| `sfMaxEndA` | 1.598 [1.598–1.598] (n=20) | n/a ×20 | — |
| `capacityLoss` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `coordLoss` | 0.000 [0.000–0.000] (n=20) | 0.000 [0.000–0.000] (n=20) | 0.000 (20 pairs) |
| `npwcDeficitSec` | 0.000 [0.000–0.000] (n=20) | 0.000 [0.000–0.001] (n=20) | 0.000 (20 pairs) |
| `slotChanges` | 0 [0–0] (n=20) | 6 [6–6] (n=20) | 6 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 2 [2–2] (n=20) | 2 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 14.000 [14.000–14.000] (n=20) | 102.000 [100.000–103.750] (n=20) | 88.000 (20 pairs) |
| `nearMisses` | 250.000 [250.000–250.000] (n=20) | 801.000 [795.250–807.000] (n=20) | 551.000 (20 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=20) | 4.016 [4.016–4.016] (n=20) | 4.016 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.931 [0.931–0.931] (n=20) | — |
| `adoptP50` | n/a ×20 | 0.700 [0.638–0.850] (n=20) | — |
| `adoptMax` | n/a ×20 | 15.400 [15.350–15.400] (n=20) | — |
| `unadopted` | 200 [200–200] (n=20) | 0 [0–0] (n=20) | -200 (20 pairs) |
| `splitSec` | 0.000 [0.000–0.000] (n=20) | 15.400 [15.350–15.400] (n=20) | 15.400 (20 pairs) |
| `tVersion` | 0.000 [0.000–0.000] (n=20) | 0.400 [0.350–0.400] (n=20) | 0.400 (20 pairs) |

---

## Notes on reading these results

Drafted by a one-off script (`notes.cjs`, not committed) from 240 records (git 0b2f8f3; paramsHash n0 200: 6342c6629553), then corrected by hand after an independent recomputation. Every number below is read from the cited records. Wording follows evaluation doc §8.

### 1. Seeds are not all independent samples

- **S0, n0 200:** the events are identical on all 20 seeds, so the static arm has 1 distinct summary and Encore varies only through the radio's random stream. Read "20/20" here as one scenario repeated, not 20 samples. Source: `events` in `S0_n200_encore_s{1..20}.json`, `summary` in `S0_n200_static_s{1..20}.json`.
- **S1, n0 200:** 20 distinct kill sets over 20 seeds. Source: `events` in `S1_n200_encore_s{1..20}.json`, `summary` in `S1_n200_static_s{1..20}.json`.
- **S2, n0 200:** 18 distinct kill sets over 20 seeds (seeds sharing one: 1=3, 12=13). Source: `events` in `S2_n200_encore_s{1..20}.json`, `summary` in `S2_n200_static_s{1..20}.json`.
- **S3, n0 200:** the events are identical on all 20 seeds, so the static arm has 1 distinct summary and Encore varies only through the radio's random stream. Read "20/20" here as one scenario repeated, not 20 samples. Source: `events` in `S3_n200_encore_s{1..20}.json`, `summary` in `S3_n200_static_s{1..20}.json`.
- **S4, n0 200:** 10 distinct kill sets over 20 seeds (seeds sharing one: 1=15=18, 2=20, 4=8, 6=11=16, 7=9=10=14, 17=19). Never write "20/20" for S4 without "10 distinct kill sets": the kill centre is drawn from the few formation-A slots within 5 m of plane P. Source: `events` in `S4_n200_encore_s{1..20}.json`, `summary` in `S4_n200_static_s{1..20}.json`.
- **S5, n0 200:** the events are identical on all 20 seeds, so the static arm has 1 distinct summary and Encore varies only through the radio's random stream and each drone's seeded SCORE-send jitter (S5 is the only one of S0, S3 and S5 that sends SCORE messages). Read "20/20" here as one scenario repeated, not 20 samples. Source: `events` in `S5_n200_encore_s{1..20}.json`, `summary` in `S5_n200_static_s{1..20}.json`.

### 2. Collision floor in both arms, including the null run

- With no events at all (S0), both arms record **14 collisions** and 250 near-misses on every seed. On seed 1 that is 11 during the launch (ticks < 300) and 3 in the change from A to the sphere (ticks 1035, 1065, 1125). The authored flight collides on its own, so "0 collisions observed" cannot be claimed for any run. Counts are sampled at 20 Hz and are lower bounds (§8). Source: `summary.collisions` and `series[].collisions` in `S0_n200_static_s{1..20}.json` and `S0_n200_encore_s{1..20}.json`.
- S1, n0 200: collisions median 14 static vs 17 Encore (range 13–21); Encore higher on 19/20 seeds, lower on seed 12. Source: `summary.collisions`, `S1_n200_static_s{1..20}.json` / encore.
- S2, n0 200: collisions median 14 static vs 16 Encore (range 15–20); Encore higher on 20/20 seeds (18 distinct kill sets). Source: `summary.collisions`, `S2_n200_static_s{1..20}.json` / encore.
- S4, n0 200: collisions median 14 static vs 19 Encore (range 16–21); Encore higher on 20/20 seeds (10 distinct kill sets). Source: `summary.collisions`, `S4_n200_static_s{1..20}.json` / encore.
- S5, n0 200: collisions median 14 static vs 102 Encore (range 95–110); Encore higher on 20/20 seeds. S5 is not like-for-like: Encore flies ENCORE→BRAVO from tick 460, static its preloaded formation change; and S5 is one seed-independent scenario repeated, not 20 samples. Source: `summary.collisions`, `S5_n200_static_s{1..20}.json` / encore.

### 3. Worst recoveries

- S2, n0 200: the slowest Encore recovery is seed 8, `tRec` 46.25 s (next slowest: seed 17, 18.25 s; median 9.38 s; censored none). On seed 8, npwc peaks at 0.945 between the kill and the change at tick 900, first reaches 0.95 at tick 1325, and `sfMaxEndA` is 7.65 m against 12.62 m for static. The hole in formation A is only partly closed; "recovery" on this seed happens in formation B. Source: `summary.tRec`, `summary.sfMaxEndA` and `series[].npwc` in `S2_n200_encore_s8.json`, `S2_n200_static_s8.json`.
- S4, n0 200: Encore `tRec` median 18.25 s, max 20.75 s; 12/20 seeds (10 distinct kill sets) take ≥ 18 s; above the 20 s bar used for S2: 1 seed (seed 5, 20.75 s); censored none. S4 has no `tRec` pass line, but its recovery is about 1.9× slower than S2's (median 9.38 s); in S4 the kill lands while the partition is on. Source: `summary.tRec` in `S4_n200_encore_s{1..20}.json`, `S2_n200_encore_s{1..20}.json`.

### 4. Regional kills: quote `sfMaxEndA`, not nPWC alone

- The nPWC gain is about the same for random kills (S1 median Δ 0.085) as for regional ones (S2 0.081, S4 0.092). Static `npwcEnd` depends only on which indices died, and `coverageEnd` is 0.900 in both arms. nPWC is priority-weighted by our own slot order, so it cannot carry a claim about *where* the holes are (§3, §8). Source: `summary.npwcEnd` and `summary.coverageEnd` in the S1, S2 and S4 n0 200 records.
- S2, n0 200: the largest gap during the kill's hold (`sfMaxEndA`) has median 7.60 m for static against 2.39 m for Encore (median paired Δ -4.88 m; Encore smaller on 20/20 seeds, 18 distinct kill sets; the smallest improvement is 4.12 m). This is the geometric evidence for the regional claim. Source: `summary.sfMaxEndA` in `S2_n200_static_s{1..20}.json` / encore.
- S4, n0 200: the largest gap during the kill's hold (`sfMaxEndA`) has median 9.24 m for static against 2.99 m for Encore (median paired Δ -6.07 m; Encore smaller on 20/20 seeds, 10 distinct kill sets; the smallest improvement is 5.66 m). This is the geometric evidence for the regional claim. Source: `summary.sfMaxEndA` in `S4_n200_static_s{1..20}.json` / encore.
- Wording: "In simulation, n0 = 200, paired seeds: during the hold in which the kill happened, the largest gap in the formation was X m for Encore against Y m for static (median). nPWC, priority-weighted by our own slot order: …". Never quote nPWC without `coverage`, `sfMean` and `sfMax` beside it.

### 5. One-off values worth stating

- `lateSlotChanges` is 0 in every record.
- S5 collisions: Encore median 102 (range 95–110) against 14 for static. On seed 1: 11 before the split, 8 during it, 84 in ticks 700–919 after reconnection and 0 later. Any S5 or dissemination claim must state this cost (#123). S5 is not like-for-like: Encore flies ENCORE→BRAVO from tick 460, static its preloaded formation change; and S5 is one seed-independent scenario repeated, not 20 samples. Source: `summary.collisions` and `series[].collisions` in `S5_n200_encore_s{1..20}.json`, `S5_n200_static_s{1..20}.json`.
- S5 `dupSlotSec` is 0 in the Encore summaries because it counts hold samples only, and the injected movement is in transition until its hold (§2, §3). The `dupSlots` series sums to a median of 15.75 slot·s. `npwcEndA` and `sfMaxEndA` are null for the same reason. Source: `summary.dupSlotSec` and `series[].dupSlots` in `S5_n200_encore_s{1..20}.json`.
- S5 shape metrics compare different formations: each world is measured against the newest score one of its own live drones believes (contract §5). At the end the Encore arm flies the injected BRAVO and static flies the preloaded sphere, so the S5 deltas of `sfMeanEnd`, `sfMaxEnd`, `npwcEnd` and `coverageEnd` are not like-for-like.
