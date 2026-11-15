# Evaluation results

Records: 80. git: `0b2f8f3c7c57f1f3d34adf99a1748ab20baae973`. paramsHash: `a3b556548345`.

Medians and IQRs skip null values, counted separately: `n/a` = not applicable (e.g. `npwcDeficitSec` with no event), `—` = key absent (e.g. `tRec` without a KILL). Exception: a censored `tRec` (not recovered) ranks above every recovered seed, and a quantile that lands on one prints `censored`. Deltas and win/tie/loss use fair pairs only (same git, paramsHash and events); other pairs are listed as MISMATCH. `npwc` is priority-weighted by our own slot order: read it beside `coverage`, `sfMean` and `sfMax`.

### S1 (n0 = 100)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.920 | 0.999 | 0.079 | WIN |
| 2 | 0.913 | 0.999 | 0.086 | WIN |
| 3 | 0.915 | 0.998 | 0.083 | WIN |
| 4 | 0.920 | 0.997 | 0.077 | WIN |
| 5 | 0.909 | 0.998 | 0.089 | WIN |
| 6 | 0.888 | 1.000 | 0.112 | WIN |
| 7 | 0.895 | 0.996 | 0.101 | WIN |
| 8 | 0.948 | 0.997 | 0.049 | WIN |
| 9 | 0.926 | 0.998 | 0.072 | WIN |
| 10 | 0.928 | 0.996 | 0.068 | WIN |
| 11 | 0.943 | 0.999 | 0.056 | WIN |
| 12 | 0.913 | 0.999 | 0.086 | WIN |
| 13 | 0.908 | 0.997 | 0.089 | WIN |
| 14 | 0.903 | 0.998 | 0.096 | WIN |
| 15 | 0.929 | 0.997 | 0.068 | WIN |
| 16 | 0.889 | 0.998 | 0.109 | WIN |
| 17 | 0.889 | 0.998 | 0.109 | WIN |
| 18 | 0.909 | 0.997 | 0.088 | WIN |
| 19 | 0.933 | 0.997 | 0.064 | WIN |
| 20 | 0.888 | 0.998 | 0.109 | WIN |

Win/tie/loss: **20 / 0 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 8, Δ 0.049.
tRec censored (not recovered): static 20 of 20, encore 0 of 20.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.913 [0.901–0.926] (n=20) | 0.998 [0.997–0.998] (n=20) | 0.086 (20 pairs) |
| `npwcEndA` | 0.913 [0.901–0.926] (n=20) | 0.992 [0.990–0.995] (n=20) | 0.080 (20 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=20) | 0.900 [0.900–0.900] (n=20) | 0.000 (20 pairs) |
| `sfMeanEnd` | 1.009 [1.005–1.015] (n=20) | 0.978 [0.978–0.979] (n=20) | -0.030 (20 pairs) |
| `sfMaxEnd` | 2.572 [2.522–2.753] (n=20) | 1.999 [1.947–2.003] (n=20) | -0.581 (20 pairs) |
| `sfMaxEndA` | 2.820 [2.572–2.989] (n=20) | 2.006 [1.839–2.117] (n=20) | -0.886 (20 pairs) |
| `capacityLoss` | 0.011 [0.011–0.011] (n=20) | 0.011 [0.011–0.011] (n=20) | 0.000 (20 pairs) |
| `coordLoss` | 0.086 [0.073–0.098] (n=20) | 0.002 [0.002–0.003] (n=20) | -0.085 (20 pairs) |
| `tRec` | censored ×20 | 5.250 [5.000–5.313] (n=20) | — |
| `npwcDeficitSec` | 5.154 [4.356–5.892] (n=20) | 0.723 [0.660–0.821] (n=20) | -4.481 (20 pairs) |
| `slotChanges` | 0.000 [0.000–0.000] (n=20) | 12.000 [10.750–13.000] (n=20) | 12.000 (20 pairs) |
| `slotChangesMaxDrone` | 0.000 [0.000–0.000] (n=20) | 1.000 [1.000–1.250] (n=20) | 1.000 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 7.000 [6.750–7.000] (n=20) | 8.000 [7.000–8.000] (n=20) | 1.000 (20 pairs) |
| `nearMisses` | 112.000 [109.750–113.000] (n=20) | 116.000 [113.000–118.000] (n=20) | 3.500 (20 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=20) | 4.000 [4.000–4.000] (n=20) | 4.000 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.950 [0.950–0.950] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | n/a ×20 | n/a ×20 | — |

### S2 (n0 = 100)

Seeds: static 20, encore 20, fair pairs 20, mismatched 0, unpaired 0. Pass lines "out of 20" scale to the fair-pair count.

npwcEnd per seed, Δ = Encore − static, win if Δ > +0.02, loss if Δ < −0.02:

| Seed | static | encore | Δ | Verdict |
|---:|---:|---:|---:|---|
| 1 | 0.912 | 0.996 | 0.084 | WIN |
| 2 | 0.917 | 0.998 | 0.081 | WIN |
| 3 | 0.912 | 0.997 | 0.085 | WIN |
| 4 | 0.900 | 0.997 | 0.097 | WIN |
| 5 | 0.929 | 0.996 | 0.067 | WIN |
| 6 | 0.905 | 0.998 | 0.093 | WIN |
| 7 | 0.905 | 0.995 | 0.090 | WIN |
| 8 | 0.923 | 0.996 | 0.074 | WIN |
| 9 | 0.917 | 0.999 | 0.082 | WIN |
| 10 | 0.923 | 0.997 | 0.074 | WIN |
| 11 | 0.906 | 0.997 | 0.091 | WIN |
| 12 | 0.918 | 0.998 | 0.080 | WIN |
| 13 | 0.918 | 0.998 | 0.080 | WIN |
| 14 | 0.911 | 0.999 | 0.088 | WIN |
| 15 | 0.901 | 0.996 | 0.095 | WIN |
| 16 | 0.919 | 0.995 | 0.076 | WIN |
| 17 | 0.904 | 0.997 | 0.093 | WIN |
| 18 | 0.910 | 0.997 | 0.086 | WIN |
| 19 | 0.898 | 0.997 | 0.098 | WIN |
| 20 | 0.918 | 0.997 | 0.079 | WIN |

Win/tie/loss: **20 / 0 / 0** of 20 fair pairs. No verdict: 0 seeds (0 mismatched, 0 unpaired, 0 with a null npwcEnd).
Worst seed (lowest Δ npwcEnd): seed 5, Δ 0.067.
tRec censored (not recovered): static 20 of 20, encore 0 of 20.

| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |
|---|---|---|---|
| `npwcEnd` | 0.912 [0.905–0.918] (n=20) | 0.997 [0.996–0.998] (n=20) | 0.085 (20 pairs) |
| `npwcEndA` | 0.912 [0.905–0.918] (n=20) | 0.983 [0.979–0.985] (n=20) | 0.068 (20 pairs) |
| `coverageEnd` | 0.900 [0.900–0.900] (n=20) | 0.900 [0.900–0.900] (n=20) | 0.000 (20 pairs) |
| `sfMeanEnd` | 1.013 [1.012–1.017] (n=20) | 0.978 [0.978–0.980] (n=20) | -0.035 (20 pairs) |
| `sfMaxEnd` | 2.688 [2.582–2.787] (n=20) | 1.995 [1.995–1.997] (n=20) | -0.689 (20 pairs) |
| `sfMaxEndA` | 6.116 [5.053–6.617] (n=20) | 2.120 [2.064–2.506] (n=20) | -3.581 (20 pairs) |
| `capacityLoss` | 0.011 [0.011–0.011] (n=20) | 0.011 [0.011–0.011] (n=20) | 0.000 (20 pairs) |
| `coordLoss` | 0.088 [0.081–0.094] (n=20) | 0.003 [0.002–0.004] (n=20) | -0.084 (20 pairs) |
| `tRec` | censored ×20 | 5.500 [5.438–5.500] (n=20) | — |
| `npwcDeficitSec` | 5.243 [4.872–5.640] (n=20) | 1.187 [1.093–1.357] (n=20) | -4.028 (20 pairs) |
| `slotChanges` | 0.000 [0.000–0.000] (n=20) | 16.000 [14.000–16.250] (n=20) | 16.000 (20 pairs) |
| `slotChangesMaxDrone` | 0 [0–0] (n=20) | 2 [2–2] (n=20) | 2 (20 pairs) |
| `lateSlotChanges` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `dupSlotsEnd` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `collisions` | 7.000 [7.000–7.000] (n=20) | 8.000 [7.750–10.000] (n=20) | 1.000 (20 pairs) |
| `nearMisses` | 113.000 [111.000–114.000] (n=20) | 118.500 [116.000–119.000] (n=20) | 6.000 (20 pairs) |
| `msgsPerDroneSec` | 0.000 [0.000–0.000] (n=20) | 4.000 [4.000–4.000] (n=20) | 4.000 (20 pairs) |
| `deliveryRatio` | n/a ×20 | 0.950 [0.950–0.950] (n=20) | — |
| `adoptP50` | n/a ×20 | n/a ×20 | — |
| `adoptMax` | n/a ×20 | n/a ×20 | — |
| `unadopted` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `splitSec` | 0 [0–0] (n=20) | 0 [0–0] (n=20) | 0 (20 pairs) |
| `tVersion` | n/a ×20 | n/a ×20 | — |

---

## Notes on reading these results

Drafted by a one-off script (`notes.cjs`, not committed) from 80 records (git 0b2f8f3; paramsHash n0 100: a3b556548345), then corrected by hand after an independent recomputation. Every number below is read from the cited records. Wording follows evaluation doc §8.

### 1. Seeds are not all independent samples

- **S1, n0 100:** 20 distinct kill sets over 20 seeds. Source: `events` in `S1_n100_encore_s{1..20}.json`, `summary` in `S1_n100_static_s{1..20}.json`.
- **S2, n0 100:** 18 distinct kill sets over 20 seeds (seeds sharing one: 1=3, 12=13). Source: `events` in `S2_n100_encore_s{1..20}.json`, `summary` in `S2_n100_static_s{1..20}.json`.

### 2. Collisions in both arms

- Not run at n0 = 100: S0, S3, S4, S5. There is no null run, so the collision floor at this n0 is not measured (n0 200's 14 does not transfer); counts are lower bounds sampled at 20 Hz (§8).
- S1, n0 100: collisions median 7 static vs 8 Encore (range 7–10); Encore higher on 12/20 seeds. Source: `summary.collisions`, `S1_n100_static_s{1..20}.json` / encore.
- S2, n0 100: collisions median 7 static vs 8 Encore (range 7–12); Encore higher on 16/20 seeds (18 distinct kill sets). Source: `summary.collisions`, `S2_n100_static_s{1..20}.json` / encore.

### 3. Worst recoveries

- S2, n0 100: the slowest Encore recovery is seed 1, `tRec` 9 s (next slowest: seed 15, 6 s; median 5.50 s; censored none). On seed 1, npwc peaks at 0.989 between the kill and the change at tick 900; after the kill it first reaches 0.95 at tick 510, dips below at ticks 565–575 and holds from tick 580, which gives the 9 s. `sfMaxEndA` is 1.75 m against 6.15 m for static. Source: `summary.tRec`, `summary.sfMaxEndA` and `series[].npwc` in `S2_n100_encore_s1.json`, `S2_n100_static_s1.json`.

### 4. Regional kills: quote `sfMaxEndA`, not nPWC alone

- S2, n0 100: the largest gap during the kill's hold (`sfMaxEndA`) has median 6.12 m for static against 2.12 m for Encore (median paired Δ -3.58 m; Encore smaller on 20/20 seeds, 18 distinct kill sets; the smallest improvement is 2.27 m). This is the geometric evidence for the regional claim. Source: `summary.sfMaxEndA` in `S2_n100_static_s{1..20}.json` / encore.
- Wording: "In simulation, n0 = 100, paired seeds: during the hold in which the kill happened, the largest gap in the formation was X m for Encore against Y m for static (median). nPWC, priority-weighted by our own slot order: …". Never quote nPWC without `coverage`, `sfMean` and `sfMax` beside it.

### 5. One-off values worth stating

- `lateSlotChanges` is nonzero in one record only: S2 n0 100 encore seed 10 = 2 (slotChanges 17). It breaks no pass line for S2, but T11 and the S1 line require 0. Source: `S2_n100_encore_s10.json`.
