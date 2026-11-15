// P2-WP-01 integration: P2-T02 (no false alarms on real runs), P2-T15 (contact model) and the read-only check.
// Results are "checked properties on these runs, not proofs".
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { EnvEvent, WorldSnapshot } from '../../src/contracts';
import { runCustom } from '../../src/cli/harness';
import { buildScenario, SCENARIO_IDS, type ScenarioId } from '../../src/cli/scenarios';
import { ContactModel, INVARIANT_IDS, KNOWN_LIMIT_3, type InvariantReport } from '../../src/observer/invariants';
import { killSetUp } from '../g1/helpers';

const WIDE = process.env.P2_WIDE === '1';
const TIMEOUT = 60_000; // Heavy world stepping: headroom for CPU contention under parallel load.
const SAFETY = ['INV-DUP', 'INV-MONO', 'INV-SILENCE', 'INV-STATIC'] as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function run(id: ScenarioId, arm: 'encore' | 'static', seed: number, n0: number, ticks?: number, checker = true) {
  const params = makeParams(n0);
  const s = buildScenario(id, seed, params);
  return runCustom(
    { label: `${id}`, seed, params, score: s.score, events: s.events, ticks: ticks ?? s.ticks, arm },
    { onSnapshot: (snap) => { deepFreeze(snap); }, invariants: checker ? undefined : false },
  );
}

function row(label: string, r: InvariantReport): string {
  return `${label.padEnd(22)} ` + INVARIANT_IDS.map((inv) => {
    if (!r.checked.includes(inv)) return `${inv}: -`;
    const first = r.violations.find((v) => v.inv === inv);
    const tagged = r.knownLimitInstances.filter((v) => v.inv === inv).length;
    return `${inv}: ${r.counts[inv] === 0 ? 'holds' : `${r.counts[inv]} (first t=${first?.tick}, tagged ${tagged})`}`;
  }).join(' | ');
}

function expectSafetyClean(r: InvariantReport) {
  for (const inv of SAFETY) expect(r.violations.filter((v) => v.inv === inv), inv).toEqual([]);
  for (const v of r.violations) expect(['INV-QUIET', 'INV-CONVERGE']).toContain(v.inv);
}

describe('P2-T02: checkers on real runs (checked properties on these runs, not proofs)', () => {
  it('short S2 (n0 40, seed 101, 500 ticks, kill at 400), both arms, frozen snapshots: no safety-like violation; Encore stateHash equal with the checker off', () => {
    const lines: string[] = [];
    for (const arm of ['encore', 'static'] as const) {
      const on = run('S2', arm, 101, 40, 500);
      if (arm === 'encore') {   // the on/off pair for both arms and all scenarios is opt-in (P2_WIDE), WP §2.3 item 7
        const off = run('S2', arm, 101, 40, 500, false);
        expect(on.record.stateHash).toBe(off.record.stateHash);
        expect(on.record.summary).toEqual(off.record.summary);
        expect(off.report).toBeNull();
      }
      const r = on.report as InvariantReport;
      expect(r.lastTick).toBe(500);
      expect(r.checked).toEqual(arm === 'encore'
        ? ['INV-DUP', 'INV-MONO', 'INV-SILENCE', 'INV-QUIET', 'INV-CONVERGE']
        : ['INV-DUP', 'INV-MONO', 'INV-STATIC']);
      expectSafetyClean(r);
      lines.push(row(`S2 ${arm} n0 40 s101`, r));
      for (const v of r.violations) lines.push(`  ${v.inv} t=${v.tick} ids=${v.ids.join(',')} tag=${v.knownLimit ?? 'none'}: ${v.detail}`);
    }
    console.log(lines.join('\n'));
  }, TIMEOUT);

  it.runIf(WIDE)('P2_WIDE: S0-S5, n0 40 seed 101 then n0 200 seeds 101-105, both arms, checker on and off', () => {
    const lines: string[] = [];
    // P2_WIDE_N0=40 runs only the n0 40 case (the n0 200 seeds are a matrix-sized run: only while matrix-quiet).
    const sizes = (process.env.P2_WIDE_N0 ?? '40,200').split(',').map(Number);
    const cases: [number, number][] = [[40, 101], ...[101, 102, 103, 104, 105].map((s): [number, number] => [200, s])]
      .filter(([n0]) => sizes.includes(n0)) as [number, number][];
    for (const [n0, seed] of cases) for (const id of SCENARIO_IDS) for (const arm of ['static', 'encore'] as const) {
      const on = run(id, arm, seed, n0);
      const off = run(id, arm, seed, n0, undefined, false);
      expect(on.record.stateHash).toBe(off.record.stateHash);
      expect(on.record.summary).toEqual(off.record.summary);
      const r = on.report as InvariantReport;
      lines.push(row(`${id} ${arm} n0 ${n0} s${seed}`, r));
      for (const v of r.violations) lines.push(`  ${v.inv} t=${v.tick} ids=${v.ids.join(',')} tag=${v.knownLimit ?? 'none'}: ${v.detail}`);
      expectSafetyClean(r);
    }
    console.log(lines.join('\n'));
  }, 3_600_000);
});

describe('P2-T15: the truth contact model agrees with the radio log', () => {
  function check(id: ScenarioId, ticks: number, events?: EnvEvent[]) {
    const params = makeParams(40);
    const s = buildScenario(id, 101, params);
    if (events) s.events = events;
    const model = new ContactModel(params, true);
    for (const e of s.events) model.recordEvent(e);
    let broadcasts = 0, blocked = 0;
    const onSnapshot = (snap: WorldSnapshot) => {
      model.beginTick(snap.tick);
      for (const e of snap.radio) {
        let reach = 0, range = 0;
        for (const d of snap.drones) {
          if (d.id === e.from || !d.alive) continue;
          if (model.inRange(e.from, d.id)) range++;
          if (model.reachable(snap, e.from, d.id)) reach++;
        }
        expect(e.delivered.length + e.lost, `tick ${snap.tick} from ${e.from}`).toBe(reach);
        expect(e.jammed + e.partitioned, `tick ${snap.tick} from ${e.from}`).toBe(range - reach);
        for (const r of e.delivered) expect(model.contact(snap, e.from, r)).toBe(true);
        broadcasts++;
        blocked += e.jammed + e.partitioned;
      }
      model.endTick(snap);
    };
    runCustom({ label: id, seed: 101, params, score: s.score, events: s.events, ticks, arm: 'encore' }, { onSnapshot, invariants: false });
    return { broadcasts, blocked };
  }

  it('default (n0 40, seed 101, 200 ticks of the S0 score): two partitions, a jam, a partition end and SET_LOSS, per broadcast', () => {
    const events: EnvEvent[] = [
      { type: 'PARTITION_ON', tick: 60, id: 'P', point: [0, 0, 0], normal: [1, 0, 0] },
      { type: 'JAM_ON', tick: 80, id: 'J', centre: [0, 0, 4], radius: 4 },
      { type: 'PARTITION_ON', tick: 100, id: 'Q', point: [0, 0, 0], normal: [0, 0, 1] },
      { type: 'SET_LOSS', tick: 120, loss: 0.3 },
      { type: 'PARTITION_OFF', tick: 150, id: 'P' },
      { type: 'JAM_OFF', tick: 170, id: 'J' },
    ];
    const r = check('S0', 200, events);
    console.log(`P2-T15 default: ${r.broadcasts} broadcasts, ${r.blocked} blocked receptions`);
    expect(r.blocked).toBeGreaterThan(0);
  }, TIMEOUT);

  it.runIf(WIDE)('P2_WIDE: S3 and S4 in full, n0 40, seed 101', () => {
    const s4 = check('S4', 1800);
    const s3 = check('S3', 1800);
    console.log(`P2-T15: S4 ${s4.broadcasts} broadcasts (${s4.blocked} blocked receptions), S3 ${s3.broadcasts} broadcasts (${s3.blocked} blocked receptions)`);
    expect(s4.blocked).toBeGreaterThan(0);
    expect(s3.blocked).toBeGreaterThan(0);
  }, 600_000);
});

// #280 / P2-T05(a): the G1 late-commit miss (§8.5 limit 3) is a KNOWN LIMIT, so INV-QUIET must tag it, never call it a
// counterexample. G1 seed 1, clumped kill of 5 at n0 40 (20 % loss), centres 15 and 30 (tests/g1/g1.beyond.test.ts:72-77).
describe('#280: the G1 late pairs fire INV-QUIET tagged §8.5 limit 3 (wave chain with one double hop)', () => {
  it('seed 1, centres 15 and 30: INV-QUIET 404 ticks after the kill, tagged, and no untagged INV-QUIET', () => {
    for (const centre of [15, 30]) {
      const s = killSetUp(1, 40, 5, centre);
      const { report } = runCustom({ label: `G1-c${centre}`, seed: 1, params: s.params, score: s.score, events: s.events, ticks: s.endTick, arm: 'encore' });
      const quiet = (report as InvariantReport).violations.filter((v) => v.inv === 'INV-QUIET');
      console.log(`G1 seed 1 centre ${centre}: kill ${s.killTick}; ${quiet.map((v) => `t=${v.tick} id=${v.ids[0]} tag=${v.knownLimit}: ${v.detail}`).join(' | ')}`);
      expect(quiet.length, `centre ${centre}`).toBeGreaterThan(0);
      expect(quiet[0]!.tick - s.killTick, `centre ${centre}`).toBe(404);
      for (const v of quiet) expect(v.knownLimit, `centre ${centre} t=${v.tick}`).toBe(KNOWN_LIMIT_3);
    }
  }, TIMEOUT);
});
