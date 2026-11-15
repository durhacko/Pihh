// tests/g4/versionOrder.test.ts
// T16 (docs/validation/evaluation-and-tests.md; contract section 9, last line): scores injected on both sides of a
// partition. After PARTITION_OFF every live drone holds the later issuedTick; on a tie, the higher origin. Real world
// (createWorld: real radio, real group partition) and the real Encore brain flying its real formation, seeds 1-5.
//
// Each injection is composed with composeNext and its origin is the drone it is injected into. The cases are chosen
// so that a wrong order rule fails:
// - later issuedTick, injected into the LOWER id: origin alone would pick the loser, so only issuedTick can win it;
// - same issuedTick: the higher origin wins, with that origin on group 0 in one case and on group 1 in the other,
//   so a side bias (say "group 0 always wins") cannot pass both;
// - the winning origin is killed during the split: the version still wins on every live drone.
// Before PARTITION_OFF each group must hold its own score and never the other's, otherwise "the later one wins
// after reconnection" would prove nothing.
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { EnvEvent, Score, ScoreVersion, Vec3, WorldSnapshot } from '../../src/contracts';
import { composeNext, makeScore } from '../../src/score';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { checkRateLimit, minSendGap, run, sameVersion } from './harness';

const N = 40;
const SEEDS = [1, 2, 3, 4, 5];
const ON = 250, OFF = 800;                // the preloaded sphere is in hold before ON
const RECOVERY = 400;                     // ticks after PARTITION_OFF by which every live drone must hold the winner
const KILL_AT = OFF - 100;                // well after both groups adopted their own score
const SPLIT = { point: [0, 30, 0] as Vec3, normal: [1, 0, 0] as Vec3 };   // through the formation centre

/** Side of plane SPLIT, as the world assigns partition groups: 0 when dot < 0, else 1. */
const side = (p: Vec3): 0 | 1 =>
  ((p[0] - SPLIT.point[0]) * SPLIT.normal[0] + (p[1] - SPLIT.point[1]) * SPLIT.normal[1] + (p[2] - SPLIT.point[2]) * SPLIT.normal[2] < 0 ? 0 : 1);

const key = (v: ScoreVersion): string => `${v.issuedTick}:${v.origin}`;

/** "issuedTick:origin" -> live drones believing it, as MetricsSample.versions counts them. */
function liveVersions(snap: WorldSnapshot): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of snap.drones) if (d.alive) m.set(key(d.belief.version), (m.get(key(d.belief.version)) ?? 0) + 1);
  return m;
}

interface Case {
  name: string;
  /** Injection tick into group 0 and into group 1. */
  ticks: [number, number];
  winner: 0 | 1;
  /** Kill the winning injector (its origin) at KILL_AT, plus two drones of the losing group. */
  killWinner?: boolean;
}

const CASES: Case[] = [
  { name: 'later issuedTick on group 1 (350 vs 300), injected into the lower id', ticks: [300, 350], winner: 1 },
  { name: 'later issuedTick on group 0 (350 vs 300), injected into the lower id', ticks: [350, 300], winner: 0 },
  { name: 'same issuedTick (300), higher origin on group 0', ticks: [300, 300], winner: 0 },
  { name: 'same issuedTick (300), higher origin on group 1', ticks: [300, 300], winner: 1 },
  { name: 'later issuedTick on group 1, its origin killed during the split', ticks: [300, 350], winner: 1, killWinner: true },
];

function twoSides(c: Case, seed: number) {
  const params = makeParams(N, { loss: 0.05 });
  const pre = makeScore([{ kind: 'sphere' }], N, params);
  const tie = c.ticks[0] === c.ticks[1];
  const loser = (1 - c.winner) as 0 | 1;
  let groups: (0 | 1)[] = [];
  const inj: [number, number] = [-1, -1];         // injector (= origin) per group
  const scores: [Score | null, Score | null] = [null, null];
  let killed: number[] = [];
  const crossAdopt: string[] = [];                // a drone holding the other group's version before PARTITION_OFF
  let atOffMinus1: Map<string, number> = new Map();
  let maxKeysDuringSplit = 0;
  let converged = null as number | null;          // first tick from which every live drone holds the winner
  let liveAtEnd = 0;

  const r = run({
    seed, params, score: pre, brain: encoreBrain, ticks: OFF + RECOVERY,
    watch: { issuedTick: -1, origin: -2 },        // unused: adoption is tracked below
    onTick: (snap, schedule: (e: EnvEvent) => void) => {
      if (snap.tick === ON - 1) {
        groups = snap.drones.map((d) => side(d.pos));
        const ids = (g: 0 | 1) => groups.flatMap((x, i) => (x === g ? [i] : []));
        const w = ids(c.winner), l = ids(loser);
        // Tie: the winner must be the higher origin. Later tick: give the winner the LOWER origin, so the test
        // fails if the brain orders by origin first.
        inj[c.winner] = tie ? Math.max(...w) : Math.min(...w);
        inj[loser] = tie ? Math.min(...l) : Math.max(...l);
        for (const g of [0, 1] as const) {
          scores[g] = composeNext(pre, c.ticks[g], g === 0 ? { kind: 'text', text: 'A' } : { kind: 'helix' }, inj[g], N, params);
        }
        schedule({ type: 'PARTITION_ON', tick: ON, id: 'P', point: [...SPLIT.point], normal: [...SPLIT.normal] });
        schedule({ type: 'PARTITION_OFF', tick: OFF, id: 'P' });
        for (const g of [0, 1] as const) schedule({ type: 'INJECT_SCORE', tick: c.ticks[g], droneId: inj[g], score: scores[g] as Score });
        if (c.killWinner) {
          killed = [inj[c.winner], ...l.filter((i) => i !== inj[loser]).slice(0, 2)];
          schedule({ type: 'KILL', tick: KILL_AT, ids: [...killed] });
        }
      }
      if (snap.tick === ON) for (const d of snap.drones) expect(d.partitionSide, `seed ${seed} drone ${d.id}`).toBe(groups[d.id]);
      if (snap.tick >= ON && snap.tick < OFF) {
        const vs = liveVersions(snap);
        maxKeysDuringSplit = Math.max(maxKeysDuringSplit, vs.size);
        for (const d of snap.drones) {
          const other = scores[(1 - groups[d.id]) as 0 | 1];
          if (other !== null && sameVersion(d.belief.version, other.version)) crossAdopt.push(`drone ${d.id} tick ${snap.tick}`);
        }
        if (snap.tick === OFF - 1) atOffMinus1 = vs;
      }
      if (snap.tick >= OFF) {
        const win = (scores[c.winner] as Score).version;
        const live = snap.drones.filter((d) => d.alive);
        const all = live.every((d) => sameVersion(d.belief.version, win));
        if (all && converged === null) converged = snap.tick;
        if (!all) converged = null;             // must hold to the end, not just touch
        liveAtEnd = live.length;
      }
    },
  });

  return {
    r, params, groups, inj, killed, crossAdopt, atOffMinus1, maxKeysDuringSplit, converged, liveAtEnd,
    win: (scores[c.winner] as Score).version, lose: (scores[loser] as Score).version,
  };
}

describe('T16: scores injected on both sides of a partition; after PARTITION_OFF every live drone holds the later issuedTick (tie: higher origin)', () => {
  for (const c of CASES) {
    it(`${c.name}: seeds 1-5`, () => {
      const lines: string[] = [];
      const gaps: number[] = [];
      for (const seed of SEEDS) {
        const x = twoSides(c, seed);
        const at = `seed ${seed}`;
        const g0 = x.groups.filter((g) => g === 0).length, g1 = N - g0;
        expect(g0, at).toBeGreaterThanOrEqual(10);
        expect(g1, at).toBeGreaterThanOrEqual(10);

        // The case is the one it claims to be.
        expect(x.win, at).not.toEqual(x.lose);
        if (c.ticks[0] === c.ticks[1]) {
          expect(x.win.issuedTick, at).toBe(x.lose.issuedTick);
          expect(x.win.origin, at).toBeGreaterThan(x.lose.origin);
        } else {
          expect(x.win.issuedTick, at).toBeGreaterThan(x.lose.issuedTick);
          expect(x.win.origin, at).toBeLessThan(x.lose.origin);
        }

        // During the split: each group holds its own score and never the other's.
        expect(x.crossAdopt, `${at}: cross-partition adoption before PARTITION_OFF`).toEqual([]);
        const own = new Map<string, number>();
        for (let id = 0; id < N; id++) {
          if (x.killed.includes(id)) continue;
          const k = key(x.groups[id] === c.winner ? x.win : x.lose);
          own.set(k, (own.get(k) ?? 0) + 1);
        }
        expect(Object.fromEntries(x.atOffMinus1), `${at}: live versions at PARTITION_OFF - 1`).toEqual(Object.fromEntries(own));
        expect(x.maxKeysDuringSplit, at).toBeLessThanOrEqual(3);   // preloaded + the two injected, never more

        // After reconnection: every live drone on the winner, and it stays there to the end of the run.
        expect(x.liveAtEnd, at).toBe(N - x.killed.length);
        expect(x.converged, `${at}: every live drone holds ${key(x.win)} from some tick to the end`).not.toBeNull();
        expect((x.converged as number) - OFF, at).toBeLessThanOrEqual(RECOVERY);
        const live = x.r.last.drones.filter((d) => d.alive);
        for (const d of live) expect(d.belief.version, `${at} drone ${d.id}`).toEqual(x.win);
        if (c.killWinner) expect(x.r.last.drones[x.inj[c.winner]].alive, at).toBe(false);

        gaps.push(minSendGap(x.r.sends));
        lines.push(`seed ${seed}: groups ${g0}/${g1}, winner ${key(x.win)} over ${key(x.lose)}, ` +
          `all ${live.length} live drones on it ${(x.converged as number) - OFF} ticks after PARTITION_OFF`);
      }
      const gap = checkRateLimit(gaps, makeParams(N).scoreResendMin);
      console.log(`T16 ${c.name}: ${lines.join('; ')}; min SCORE gap ${gap}`);
    }, 120_000);
  }
});
