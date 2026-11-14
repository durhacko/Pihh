// tests/g4/harness.ts
// Gate G4 (issue #21): score dissemination on the REAL world (src/sim createWorld: real radio with latency, loss,
// jams and partitions) with the REAL Encore brain. Not a test file itself.
//
// pinnedEncore(pins): for geometry tests (T18), each drone steers to a fixed point instead of to its slot. The
// wrapper delegates init, step and belief to encoreBrain untouched and replaces only the returned acceleration,
// so every message the drone sends or adopts is the real brain's decision. A pinned drone is never settled at its
// slot, so canHeal is false and it never claims: the test sees score gossip alone.
import { DT, OPERATOR } from '../../src/contracts';
import type { AgentBrain, EnvEvent, Params, Score, ScoreVersion, Vec3, WorldSnapshot } from '../../src/contracts';
import { createWorld } from '../../src/sim';
import { encoreBrain } from '../../src/agent/encoreBrain';
import type { EncoreState } from '../../src/agent/state';
import { steer } from '../../src/agent/steer';

export interface PinnedState { inner: EncoreState; pin: Vec3 }

export function pinnedEncore(pins: readonly Vec3[]): AgentBrain<PinnedState> {
  return {
    kind: 'encore',
    init(init) {
      const pin = pins[init.id];
      if (pin === undefined) throw new RangeError(`no pin for drone ${init.id}`);
      return { inner: encoreBrain.init(init), pin: [pin[0], pin[1], pin[2]] };
    },
    step(s, input) {
      const out = encoreBrain.step(s.inner, input);
      return { ...out, accel: steer(input.pos, input.vel, s.pin, input.sensed, s.inner.params) };
    },
    belief(s) {
      return encoreBrain.belief(s.inner);
    },
  };
}

export const sameVersion = (a: ScoreVersion, b: ScoreVersion): boolean => a.issuedTick === b.issuedTick && a.origin === b.origin;
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface ScoreSend { tick: number; from: number; delivered: number[]; lost: number; jammed: number; partitioned: number }

export interface Run {
  params: Params;
  /** First tick at which each drone believes `watch` (null: never within the run). */
  adopted: (number | null)[];
  /** Every SCORE broadcast a drone (not the operator) made, from the medium's own log. */
  sends: ScoreSend[];
  /** Version each drone believes after the last tick. */
  finalVersions: ScoreVersion[];
  /** Number of believed-slot changes per drone over the run (contract section 8.5, limit 7 churn). */
  slotChanges: number[];
  /** Ticks on which some slot was believed by two or more live drones. */
  dupTicks: number;
  last: WorldSnapshot;
}

export interface RunOptions {
  seed: number;
  params: Params;
  score: Score;
  brain: AgentBrain;
  ticks: number;
  events?: EnvEvent[];
  watch: ScoreVersion;                                   // the version whose adoption is timed
  /** Called after every tick with the snapshot; may schedule events (tick must be in the future). */
  onTick?: (snap: WorldSnapshot, schedule: (e: EnvEvent) => void) => void;
}

export function run(o: RunOptions): Run {
  const world = createWorld({ seed: o.seed, params: o.params, brain: o.brain, score: o.score, events: o.events ?? [] });
  const n0 = o.params.n0;
  const adopted: (number | null)[] = Array.from({ length: n0 }, () => null);
  const sends: ScoreSend[] = [];
  const slotChanges = Array.from({ length: n0 }, () => 0);
  const lastSlot: number[] = Array.from({ length: n0 }, (_, i) => i);
  let dupTicks = 0;
  let last: WorldSnapshot | null = null;
  for (let t = 0; t < o.ticks; t++) {
    const snap = world.step();
    last = snap;
    for (const r of snap.radio) {
      if (r.type === 'SCORE' && r.from !== OPERATOR) {
        sends.push({ tick: r.tick, from: r.from, delivered: [...r.delivered], lost: r.lost, jammed: r.jammed, partitioned: r.partitioned });
      }
    }
    const seen = new Set<number>();
    let dup = false;
    for (const d of snap.drones) {
      if (adopted[d.id] === null && sameVersion(d.belief.version, o.watch)) adopted[d.id] = snap.tick;
      if (d.belief.slot !== lastSlot[d.id]) { slotChanges[d.id]++; lastSlot[d.id] = d.belief.slot; }
      if (d.alive) { if (seen.has(d.belief.slot)) dup = true; seen.add(d.belief.slot); }
    }
    if (dup) dupTicks++;
    o.onTick?.(snap, (e) => world.schedule(e));
  }
  if (last === null) throw new Error('run: no ticks');
  return {
    params: o.params, adopted, sends, slotChanges, dupTicks, last,
    finalVersions: last.drones.map((d) => ({ issuedTick: d.belief.version.issuedTick, origin: d.belief.version.origin })),
  };
}

/** Rate limit (section 9): every pair of consecutive SCORE sends by one drone is at least scoreResendMin apart. */
export function minSendGap(sends: readonly ScoreSend[]): number {
  const byDrone = new Map<number, number[]>();
  for (const s of sends) {
    const ticks = byDrone.get(s.from) ?? [];
    ticks.push(s.tick);
    byDrone.set(s.from, ticks);
  }
  let min = Infinity;
  for (const ticks of byDrone.values()) for (let i = 1; i < ticks.length; i++) min = Math.min(min, ticks[i] - ticks[i - 1]);
  return min;
}

/** Seconds, for reporting. */
export const secs = (ticks: number): string => (ticks * DT).toFixed(2);
