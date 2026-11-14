// research/experiments/80-collisions/measure.ts
// THROWAWAY SPIKE for issue #80. Not part of the product; nothing in src/ imports this.
//
// Measures S0 (no events) collisions / near-misses of the STATIC arm under steering variants, split by
// phase, plus arrival, plus a swept (closest-approach-within-the-tick) audit of the endpoint counts.
//
//   npx tsx research/experiments/80-collisions/measure.ts [--seeds 1-5] [--n0 200] [--only name,name] [--json out.json]
//
// The variant brain below is a copy of src/agent/staticBrain.ts whose steering is `steerVariant`, a copy of
// src/agent/steer.ts with two opt-in switches (time-to-contact sidestep, paced targets). With every switch off
// it must reproduce the shipped static brain bit-for-bit; the script checks that (stateHash equality) first.
import { makeParams } from '../../../src/contracts';
import type { AgentBrain, AgentInit, AgentInput, AgentOutput, Belief, Params, Score, Sensed, Vec3, WorldSnapshot } from '../../../src/contracts';
import { currentMovement, expandRecipe, launchPos } from '../../../src/score';
import { createWorld } from '../../../src/sim';
import { staticBrain } from '../../../src/agent/staticBrain';
import { steerTarget } from '../../../src/agent/steer';
import { buildScenario } from '../../../src/cli/scenarios';
import { onSlotFraction } from '../../../src/cli/run';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------------------------------------
// Steering: src/agent/steer.ts, plus the time-to-contact sidestep (option 3 of #80).
// ---------------------------------------------------------------------------------------------------------
const TRACK_GAIN = 4;
const SIDESTEP_FRACTION = 0.3;
const VERTICAL_EPS = 1e-9;
/** Look-ahead of the time-to-contact sidestep, seconds. */
const TTC_LOOKAHEAD = 0.5;

interface SteerOpts { ttc: boolean }

function steerVariant(pos: Vec3, vel: Vec3, target: Vec3, sensed: readonly Sensed[], params: Params, opts: SteerOpts): Vec3 {
  const { vMax, aMax, dAvoid } = params;
  const dx = target[0] - pos[0];
  const dy = target[1] - pos[1];
  const dz = target[2] - pos[2];
  const dist = Math.hypot(dx, dy, dz);
  const k = dist > 0 ? Math.min(vMax, Math.sqrt(aMax * dist)) / dist : 0;
  let ax = (dx * k - vel[0]) * TRACK_GAIN;
  let ay = (dy * k - vel[1]) * TRACK_GAIN;
  let az = (dz * k - vel[2]) * TRACK_GAIN;

  for (let i = 0; i < sensed.length; i++) {
    const rel = sensed[i].rel;
    const relVel = sensed[i].vel;
    const rx = rel[0];
    const ry = rel[1];
    const rz = rel[2];
    const r = Math.hypot(rx, ry, rz);
    if (!(r > 0)) continue;
    const dot = rx * relVel[0] + ry * relVel[1] + rz * relVel[2];
    const closing = dot < 0;
    // Shipped: sidestep only while r < dAvoid. TTC: also while r < dAvoid + closingSpeed * 0.5 s.
    const sideRange = opts.ttc && closing ? dAvoid + (-dot / r) * TTC_LOOKAHEAD : dAvoid;
    if (!(r < dAvoid) && !(r < sideRange)) continue;

    if (r < dAvoid) {
      const push = (aMax * (dAvoid - r)) / dAvoid;
      ax -= (rx / r) * push;
      ay -= (ry / r) * push;
      az -= (rz / r) * push;
    }
    if (closing) {
      const side = SIDESTEP_FRACTION * aMax;
      const h = Math.hypot(rx, rz);
      if (h > VERTICAL_EPS * r) {
        ax += (-rz / h) * side;
        az += (rx / h) * side;
      } else {
        const f = Math.hypot(ry, rz);
        ay += (rz / f) * side;
        az += (-ry / f) * side;
      }
    }
  }
  return [ax, ay, az];
}

// ---------------------------------------------------------------------------------------------------------
// Variant static brain.
// Paced targets: instead of jumping to the new slot when a movement starts, aim at lerp(previous slot, new slot, f)
// with f = clamp((tick - max(startTick, 0)) / flight, 0, 1). Brain-local, no radio, deterministic.
//   mode 'authored': flight = scale * (transitionTicks - 60), the displacement part of the authoring formula
//                    (maxDisplacement / (0.5 vMax)): at scale 1 the farthest drone's target moves at 0.5 vMax.
//   mode 'score':    flight = scale * (holdStart - max(startTick, 0)): the target reaches the slot exactly when the
//                    score says the hold begins (scale 1). Uses only the score's own timing; nothing is re-authored.
// which 'B': movement A (launch) is not paced, only later movements.
// transitLanes with pacing: the lane offset is decided from the distance to the REAL slot (not the paced target,
// which the drone trails by < 3 m, so steerTarget would never apply the offset) and added to the paced target.
// ---------------------------------------------------------------------------------------------------------
interface Pace { mode: 'none' | 'authored' | 'score'; scale: number; which: 'all' | 'B' }
interface VariantState { id: number; n0: number; score: Score; params: Params; lastTarget: Vec3; ttc: boolean; pace: Pace }
const SETTLE_TICKS = 60; // 3 s, the authoring formula's settle allowance
const NO_PACE: Pace = { mode: 'none', scale: 1, which: 'all' };

function slotPos(score: Score, index: number, slot: number, n0: number, params: Params): Vec3 {
  if (index < 0) return launchPos(slot, n0);
  const m = score.movements[index];
  return expandRecipe(m.recipe, n0, params).slots[slot].pos;
}

function makeVariantBrain(ttc: boolean, pace: Pace): AgentBrain<VariantState> {
  return {
    kind: 'static',
    init(init: AgentInit): VariantState {
      const s: VariantState = {
        id: init.id, n0: init.n0, score: JSON.parse(JSON.stringify(init.score)) as Score,
        params: JSON.parse(JSON.stringify(init.params)) as Params, lastTarget: [0, 0, 0], ttc, pace,
      };
      const p = slotPos(s.score, currentMovement(s.score, 0).index, s.id, s.n0, s.params);
      s.lastTarget = [p[0], p[1], p[2]];
      return s;
    },
    step(s: VariantState, input: AgentInput): AgentOutput {
      const cm = currentMovement(s.score, input.tick);
      const slot = expandRecipe(cm.movement.recipe, s.n0, s.params).slots[s.id];
      const real: Vec3 = [slot.pos[0], slot.pos[1], slot.pos[2]];
      let target: Vec3 = real;
      const p = s.pace;
      if (p.mode !== 'none' && !(p.which === 'B' && cm.index === 0)) {
        const prev = slotPos(s.score, cm.index - 1, s.id, s.n0, s.params);
        const begin = Math.max(cm.movement.startTick, 0);
        const window = p.mode === 'authored' ? cm.movement.transitionTicks - SETTLE_TICKS : cm.movement.startTick + cm.movement.transitionTicks - begin;
        const flight = Math.max(1, window * p.scale);
        const f = Math.min(1, Math.max(0, (input.tick - begin) / flight));
        target = [prev[0] + (real[0] - prev[0]) * f, prev[1] + (real[1] - prev[1]) * f, prev[2] + (real[2] - prev[2]) * f];
      }
      s.lastTarget = target;
      // Lane offset judged against the real slot; identical to steerTarget(id, pos, target) when unpaced.
      const lane = steerTarget(s.id, input.pos, real, s.params);
      const aim: Vec3 = [target[0] + lane[0] - real[0], target[1] + lane[1] - real[1], target[2] + lane[2] - real[2]];
      const accel = steerVariant(input.pos, input.vel, target === real ? lane : aim, input.sensed, s.params, { ttc: s.ttc });
      return { accel, colour: [slot.colour[0], slot.colour[1], slot.colour[2]], outbox: [] };
    },
    belief(s: VariantState): Belief {
      return {
        slot: s.id, heldSince: 0, target: [...s.lastTarget] as Vec3,
        version: { issuedTick: s.score.version.issuedTick, origin: s.score.version.origin },
        deaf: false, canHeal: false, claiming: null, peersKnown: 0, log: [],
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Configurations.
// ---------------------------------------------------------------------------------------------------------
interface Config { name: string; label: string; lanes: boolean; ttc: boolean; pace: Pace; authorScale: number; aStart?: number }
const au = (scale: number, which: 'all' | 'B' = 'all'): Pace => ({ mode: 'authored', scale, which });
const sc = (scale: number, which: 'all' | 'B' = 'all'): Pace => ({ mode: 'score', scale, which });
const CONFIGS: Config[] = [
  { name: 'C1', label: 'defaults (baseline)', lanes: false, ttc: false, pace: NO_PACE, authorScale: 1 },
  { name: 'C2', label: 'transitLanes: true', lanes: true, ttc: false, pace: NO_PACE, authorScale: 1 },
  { name: 'C3', label: 'TTC sidestep', lanes: false, ttc: true, pace: NO_PACE, authorScale: 1 },
  { name: 'C4', label: 'transitLanes + TTC sidestep', lanes: true, ttc: true, pace: NO_PACE, authorScale: 1 },
  { name: 'C5a', label: 'transitionTicks x1.5 in the score only (null by construction)', lanes: false, ttc: false, pace: NO_PACE, authorScale: 1.5 },
  { name: 'C5b', label: 'paced, 1.0x authored flight (0.5 vMax), all', lanes: false, ttc: false, pace: au(1), authorScale: 1 },
  { name: 'C5c', label: 'paced, 1.5x authored flight (0.33 vMax), all', lanes: false, ttc: false, pace: au(1.5), authorScale: 1 },
  { name: 'C5d', label: 'paced, 1.5x authored flight, text-to-sphere only', lanes: false, ttc: false, pace: au(1.5, 'B'), authorScale: 1 },
  { name: 'C6', label: 'paced to the score (arrive at holdStart), all', lanes: false, ttc: false, pace: sc(1), authorScale: 1 },
  { name: 'C6b', label: 'paced to the score + TTC', lanes: false, ttc: true, pace: sc(1), authorScale: 1 },
  { name: 'C6c', label: 'paced to the score + transitLanes (lane from real slot)', lanes: true, ttc: false, pace: sc(1), authorScale: 1 },
  { name: 'C6d', label: 'paced to the score, text-to-sphere only', lanes: false, ttc: false, pace: sc(1, 'B'), authorScale: 1 },
  { name: 'C5e', label: 'paced 1.0x authored + TTC, all', lanes: false, ttc: true, pace: au(1), authorScale: 1 },
  { name: 'C7', label: 'paced to the score + A_START_TICK -60 (holdA 303)', lanes: false, ttc: false, pace: sc(1), authorScale: 1, aStart: -60 },
  { name: 'C7b', label: 'paced to the score + A_START_TICK -60 + TTC', lanes: false, ttc: true, pace: sc(1), authorScale: 1, aStart: -60 },
];

// Phase windows (ticks, inclusive). Fixed across configs so the columns compare like with like.
const LAUNCH_END = 400;
const B_START = 900;
const B_WINDOW_END = 1399;
type Phase = 'launch' | 'holdA' | 'transB' | 'holdB';
function phaseOf(t: number): Phase {
  if (t <= LAUNCH_END) return 'launch';
  if (t < B_START) return 'holdA';
  if (t <= B_WINDOW_END) return 'transB';
  return 'holdB';
}

// ---------------------------------------------------------------------------------------------------------
// One run.
// ---------------------------------------------------------------------------------------------------------
interface ContactSample { tick: number; a: number; b: number; endD: number; sweptD: number; relSpeed: number; reentry: boolean }
interface RunResult {
  config: string; seed: number; stateHash: string;
  holdA: number; holdB: number;
  col: Record<Phase, number>; near: Record<Phase, number>;
  onSlot400: number; onSlotEnd: number; arriveA95: number | null; arriveB95: number | null;
  // Swept audit
  sweptCol: number;           // pair entries into swept distance < dCollide (closest approach within the tick)
  sweptNear: number;
  missedCol: number;          // swept collision entries whose tick-end distance was >= dCollide (endpoint sampling missed them)
  colEpisodes: number;        // endpoint collisions merged per pair when they re-enter within 20 ticks
  colReentries: number;       // endpoint collisions that are re-entries of a pair counted within the last 20 ticks
  slowContacts: number;       // endpoint collisions at relative speed < 1 m/s (jostling, not crossing)
  episodeMin: number[];       // per swept collision episode: the closest approach (m) over the whole contact
  samples: ContactSample[];
}

const REENTRY_TICKS = 20;

function segMinDist(p0: number[], p1: number[]): number {
  // min over s in [0,1] of |p0 + s (p1 - p0)|
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  let s = dd > 0 ? -(p0[0] * d[0] + p0[1] * d[1] + p0[2] * d[2]) / dd : 0;
  s = Math.max(0, Math.min(1, s));
  return Math.hypot(p0[0] + s * d[0], p0[1] + s * d[1], p0[2] + s * d[2]);
}

function runConfig(cfg: Config, seed: number, n0: number, brainOverride?: AgentBrain): RunResult {
  const params = makeParams(n0, { transitLanes: cfg.lanes });
  const scenario = buildScenario('S0', seed, params);
  const score: Score = JSON.parse(JSON.stringify(scenario.score)) as Score;
  if (cfg.aStart !== undefined) score.movements[0].startTick = cfg.aStart;
  if (cfg.authorScale !== 1) for (const m of score.movements) m.transitionTicks = Math.ceil(m.transitionTicks * cfg.authorScale);
  const brain = brainOverride ?? makeVariantBrain(cfg.ttc, cfg.pace);
  const world = createWorld({ seed, params, brain, score, events: [] });

  const holdA = score.movements[0].startTick + score.movements[0].transitionTicks;
  const holdB = score.movements[1].startTick + score.movements[1].transitionTicks;
  const zero = (): Record<Phase, number> => ({ launch: 0, holdA: 0, transB: 0, holdB: 0 });
  const res: RunResult = {
    config: cfg.name, seed, stateHash: '', holdA, holdB, col: zero(), near: zero(),
    onSlot400: NaN, onSlotEnd: NaN, arriveA95: null, arriveB95: null,
    sweptCol: 0, sweptNear: 0, missedCol: 0, colEpisodes: 0, colReentries: 0, slowContacts: 0, episodeMin: [], samples: [],
  };

  const N = n0;
  let prev = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) { const p = launchPos(i, N); prev.set([p[0], p[1], 0], i * 3); }
  // launchPos in score may differ from the sim's launchPosition only if they diverge; sim truth is used after tick 1.
  let first = true;
  const sweptColIn = new Uint8Array(N * N);
  const sweptNearIn = new Uint8Array(N * N);
  const lastColTick = new Int32Array(N * N).fill(-1_000_000);
  const depth = new Float64Array(N * N);
  const dC2 = params.dCollide ** 2;
  const reach = params.dNear + 2 * params.vMax * 0.05 + 0.01; // max endpoint distance for a swept dNear contact

  const total = scenario.ticks;
  for (let t = 1; t <= total; t++) {
    const snap: WorldSnapshot = world.step();
    const cur = new Float64Array(N * 3);
    for (const d of snap.drones) cur.set(d.pos, d.id * 3);
    if (first) {
      // Recover true tick-0 positions: pos(1) - vel(1) * DT.
      for (const d of snap.drones) prev.set([d.pos[0] - d.vel[0] * 0.05, d.pos[1] - d.vel[1] * 0.05, d.pos[2] - d.vel[2] * 0.05], d.id * 3);
      first = false;
    }
    const ph = phaseOf(t);
    res.col[ph] += snap.collisions.length;
    res.near[ph] += snap.nearMisses.length;

    // Endpoint collisions: re-entry and speed audit.
    for (const [a, b] of snap.collisions) {
      const key = a * N + b;
      const reentry = t - lastColTick[key] <= REENTRY_TICKS;
      if (reentry) res.colReentries++; else res.colEpisodes++;
      lastColTick[key] = t;
      const da = snap.drones[a], db = snap.drones[b];
      const relSpeed = Math.hypot(da.vel[0] - db.vel[0], da.vel[1] - db.vel[1], da.vel[2] - db.vel[2]);
      if (relSpeed < 1) res.slowContacts++;
      if (res.samples.length < 400) {
        const p0 = [prev[b * 3] - prev[a * 3], prev[b * 3 + 1] - prev[a * 3 + 1], prev[b * 3 + 2] - prev[a * 3 + 2]];
        const p1 = [cur[b * 3] - cur[a * 3], cur[b * 3 + 1] - cur[a * 3 + 1], cur[b * 3 + 2] - cur[a * 3 + 2]];
        res.samples.push({ tick: t, a, b, endD: Math.hypot(p1[0], p1[1], p1[2]), sweptD: segMinDist(p0, p1), relSpeed, reentry });
      }
    }

    // Swept detection over all pairs (O(n^2), fine at n0 = 200). Positions move linearly within a tick
    // (semi-implicit Euler: pos += vel(t) * DT), so the relative motion is a straight segment.
    for (let a = 0; a < N; a++) {
      const ax0 = prev[a * 3], ay0 = prev[a * 3 + 1], az0 = prev[a * 3 + 2];
      const ax1 = cur[a * 3], ay1 = cur[a * 3 + 1], az1 = cur[a * 3 + 2];
      for (let b = a + 1; b < N; b++) {
        const key = a * N + b;
        const ex = cur[b * 3] - ax1, ey = cur[b * 3 + 1] - ay1, ez = cur[b * 3 + 2] - az1;
        const end2 = ex * ex + ey * ey + ez * ez;
        if (end2 > reach * reach && !sweptNearIn[key]) continue;
        const p0 = [prev[b * 3] - ax0, prev[b * 3 + 1] - ay0, prev[b * 3 + 2] - az0];
        const sd = segMinDist(p0, [ex, ey, ez]);
        const inC = sd < params.dCollide ? 1 : 0;
        const inN = sd < params.dNear ? 1 : 0;
        if (inC && !sweptColIn[key]) { res.sweptCol++; if (end2 >= dC2) res.missedCol++; depth[key] = sd; }
        if (inC && sd < depth[key]) depth[key] = sd;
        if (!inC && sweptColIn[key]) res.episodeMin.push(depth[key]);
        if (inN && !sweptNearIn[key]) res.sweptNear++;
        sweptColIn[key] = inC;
        sweptNearIn[key] = inN;
      }
    }

    if (t === LAUNCH_END) res.onSlot400 = onSlotFraction(snap, score, params);
    if (t === total) res.onSlotEnd = onSlotFraction(snap, score, params);
    if (res.arriveA95 === null && t < B_START && onSlotFraction(snap, score, params) >= 0.95) res.arriveA95 = t;
    if (res.arriveB95 === null && t >= B_START && onSlotFraction(snap, score, params) >= 0.95) res.arriveB95 = t;
    prev = cur;
    if (t === total) {
      // Kinematic fingerprint (pos, vel, colour, counts): world.stateHash() also covers brain state, whose shape differs.
      res.stateHash = createHash('sha256').update(JSON.stringify([snap.drones.map((d) => [d.pos, d.vel, d.colour]), res.col, res.near])).digest('hex');
    }
  }
  // Episodes still in contact at the last tick.
  for (let key = 0; key < N * N; key++) if (sweptColIn[key]) res.episodeMin.push(depth[key]);
  return res;
}

// ---------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
// S0 has no events, its score is seed-independent, and the world's RNG drives only the radio, which the static
// brain never uses: every seed is the same run. Default to seed 1 and prove the claim below (seed 1 vs seed 2).
const seedArg = arg('seeds') ?? '1';
const [s0, s1] = seedArg.split('-').map(Number);
const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
const n0 = Number(arg('n0') ?? 200);
const only = arg('only')?.split(',');
const jsonOut = arg('json');

// 0. Equivalence check: the variant brain with all switches off == the shipped static brain.
{
  const c1 = CONFIGS[0];
  const shipped = runConfig(c1, seeds[0], n0, staticBrain as AgentBrain);
  const variant = runConfig(c1, seeds[0], n0);
  const same = shipped.stateHash === variant.stateHash;
  console.log(`equivalence (seed ${seeds[0]}): shipped staticBrain ${shipped.stateHash.slice(0, 12)} vs variant ${variant.stateHash.slice(0, 12)} -> ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
  if (!same) throw new Error('Variant brain with switches off does not reproduce the shipped static brain');
  const c2s = runConfig(CONFIGS[1], seeds[0], n0, staticBrain as AgentBrain);
  const c2v = runConfig(CONFIGS[1], seeds[0], n0);
  console.log(`equivalence lanes (seed ${seeds[0]}): ${c2s.stateHash === c2v.stateHash ? 'IDENTICAL' : 'DIFFERENT'}`);
  if (c2s.stateHash !== c2v.stateHash) throw new Error('Variant brain with lanes does not reproduce the shipped static brain');
  const other = runConfig(c1, seeds[0] + 1, n0, staticBrain as AgentBrain);
  console.log(`seed independence: shipped staticBrain seed ${seeds[0]} vs seed ${seeds[0] + 1} -> ${other.stateHash === shipped.stateHash ? 'IDENTICAL (S0 static is deterministic in the seed)' : 'DIFFERENT'}`);
}

const all: RunResult[] = [];
for (const cfg of CONFIGS) {
  if (only && !only.includes(cfg.name)) continue;
  for (const seed of seeds) {
    const r = runConfig(cfg, seed, n0);
    all.push(r);
    const c = r.col, nm = r.near;
    console.log(
      `${cfg.name} seed ${seed}: col L/A/T/B ${c.launch}/${c.holdA}/${c.transB}/${c.holdB} ` +
      `near ${nm.launch}/${nm.holdA}/${nm.transB}/${nm.holdB} on400 ${(r.onSlot400 * 100).toFixed(1)}% ` +
      `onEnd ${(r.onSlotEnd * 100).toFixed(1)}% arrA95 ${r.arriveA95} arrB95 ${r.arriveB95} holdA ${r.holdA} holdB ${r.holdB} ` +
      `swept ${r.sweptCol} missed ${r.missedCol} episodes ${r.colEpisodes} reentries ${r.colReentries} slow ${r.slowContacts} hash ${r.stateHash.slice(0, 10)}`,
    );
  }
}

// Summary table (means over seeds).
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log('\n| cfg | collisions launch / transB / holds = total | near-misses launch / transB / holds = total | swept col | missed by endpoint | col episodes | on slot @400 | on slot @1800 | 95% arrival A / B |');
for (const cfg of CONFIGS) {
  const rs = all.filter((r) => r.config === cfg.name);
  if (!rs.length) continue;
  const f = (x: number) => x.toFixed(1);
  const cl = mean(rs.map((r) => r.col.launch)), ct = mean(rs.map((r) => r.col.transB)), ch = mean(rs.map((r) => r.col.holdA + r.col.holdB));
  const nl = mean(rs.map((r) => r.near.launch)), nt = mean(rs.map((r) => r.near.transB)), nh = mean(rs.map((r) => r.near.holdA + r.near.holdB));
  const arrA = rs.map((r) => r.arriveA95 ?? NaN), arrB = rs.map((r) => r.arriveB95 ?? NaN);
  console.log(
    `| ${cfg.name} ${cfg.label} | ${f(cl)} / ${f(ct)} / ${f(ch)} = ${f(cl + ct + ch)} | ${f(nl)} / ${f(nt)} / ${f(nh)} = ${f(nl + nt + nh)} ` +
    `| ${f(mean(rs.map((r) => r.sweptCol)))} | ${f(mean(rs.map((r) => r.missedCol)))} | ${f(mean(rs.map((r) => r.colEpisodes)))} ` +
    `| ${(mean(rs.map((r) => r.onSlot400)) * 100).toFixed(1)}% (min ${(Math.min(...rs.map((r) => r.onSlot400)) * 100).toFixed(1)}) ` +
    `| ${(mean(rs.map((r) => r.onSlotEnd)) * 100).toFixed(1)}% (min ${(Math.min(...rs.map((r) => r.onSlotEnd)) * 100).toFixed(1)}) ` +
    `| ${Math.max(...arrA)} / ${Math.max(...arrB)} (worst seed) |`,
  );
}

// Arrival relative to the score's hold start (the Encore brain reads holdStart + holdGrace as "should be there").
console.log('\narrival vs score: cfg holdA arrA95 (arrA95 - holdA) | holdB arrB95 (arrB95 - holdB)');
for (const r of all.filter((x) => x.seed === seeds[0])) {
  console.log(`${r.config}: ${r.holdA} ${r.arriveA95} (${(r.arriveA95 ?? NaN) - r.holdA}) | ${r.holdB} ${r.arriveB95} (${(r.arriveB95 ?? NaN) - r.holdB})`);
}

// Swept audit of endpoint collisions, per config (every endpoint collision is sampled; the cap of 400 per run is never reached).
console.log('\nswept audit per cfg: endpoint collisions | re-entries | rel. speed at count (<1,<2,<4,<8,>=8 m/s) | swept-min < endpoint by >0.05 m | contact depth: median, <0.2 m, <0.1 m');
for (const cfg of CONFIGS) {
  const rs = all.filter((r) => r.config === cfg.name);
  if (!rs.length) continue;
  const samples = rs.flatMap((r) => r.samples);
  const bins = [1, 2, 4, 8, Infinity];
  const hist = bins.map((hi, i) => samples.filter((s) => s.relSpeed < hi && s.relSpeed >= (i ? bins[i - 1] : 0)).length);
  const eps = rs.flatMap((r) => r.episodeMin).sort((a, b) => a - b);
  const med = eps.length ? eps[Math.floor(eps.length / 2)].toFixed(3) : '-';
  console.log(`${cfg.name}: ${samples.length} | ${samples.filter((s) => s.reentry).length} | ${hist.join('/')} | ${samples.filter((s) => s.endD - s.sweptD > 0.05).length} ` +
    `| ${med}, ${eps.filter((d) => d < 0.2).length}, ${eps.filter((d) => d < 0.1).length} (of ${eps.length})`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all.map((r) => ({ ...r, samples: r.samples.slice(0, 50) })), null, 1));
