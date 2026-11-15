// scripts/perf/simBench.ts
// Simulation cost without rendering: both worlds stepped in lockstep with their observers, exactly as the app's
// advance() does (worlds.stepBoth), in Node. Prints one JSON object. Run with: npx tsx scripts/perf/simBench.ts
// The browser cannot compare roster sizes (the app has no n0 option; it always builds 200), so this is where
// 100 vs 200 drones is measured. These are Node timings on this machine, not browser timings.
import { performance } from 'node:perf_hooks';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { createWorlds } from '../../src/app/worlds';

const WARMUP_TICKS = 100;
const MEASURED_TICKS = Number(process.env.SIM_BENCH_TICKS ?? 600);

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

function bench(n0: number, encoreArm: 'static' | 'encore') {
  const worlds = createWorlds({ seed: 101, n0, ...(encoreArm === 'encore' ? { brains: { encore: encoreBrain } } : {}) });
  for (let i = 0; i < WARMUP_TICKS; i++) worlds.stepBoth();
  const times: number[] = [];
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const start = performance.now();
    worlds.stepBoth();
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    n0, encoreArmBrain: encoreArm, staticArmBrain: 'static', ticks: MEASURED_TICKS, fromTick: WARMUP_TICKS + 1,
    stepBothMs: { mean: round(mean), p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), max: round(sorted.at(-1) as number) },
    // 20 Hz needs one stepBoth in 50 ms; the frame budget at 60 fps is 16.7 ms for everything, rendering included.
    maxTicksPerSecond: round(1000 / mean),
  };
}
const round = (v: number) => Math.round(v * 1000) / 1000;

const results = [];
for (const n0 of [100, 200]) for (const arm of ['static', 'encore'] as const) results.push(bench(n0, arm));
process.stdout.write(`${JSON.stringify({ node: process.version, results })}\n`);
