// P2-WP-10 · X3 dual injection across a partition (PHASE2_EVALUATION §6.1, P2-T14). Exploratory evidence:
// "checked properties on these runs, not proofs". Unit tests run by default; the run is opt-in (P2_WIDE=1).
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import { expandRecipe, newerVersion } from '../../src/score';
import { buildX3, formatX3Row, runX3, X3_SLOT_CHANGES_CAP, X3_TICKS, X3_X_SPLIT } from '../../src/cli/dualInject';
import { PARTITION_ID, PLANE_P, RECIPE_A } from '../../src/cli/scenarios';

const WIDE = process.env.P2_WIDE === '1';

describe('X3 event builder (§6.1)', () => {
  for (const n0 of [40, 200]) {
    it(`n0 ${n0}: targets on opposite sides of plane P, ticks ordered, two distinct versions, the later one wins`, () => {
      const params = makeParams(n0);
      const x3 = buildX3(1, params);
      const slots = expandRecipe(RECIPE_A, n0, params).slots.map((s) => s.pos);
      // The lowest id with A-slot x < -10, and the lowest with x > +10 (plane P is x = 0, normal +x).
      expect(slots[x3.targets.a]![0]).toBeLessThan(-X3_X_SPLIT);
      expect(slots[x3.targets.b]![0]).toBeGreaterThan(X3_X_SPLIT);
      for (let i = 0; i < x3.targets.a; i++) expect(slots[i]![0]).toBeGreaterThanOrEqual(-X3_X_SPLIT);
      for (let i = 0; i < x3.targets.b; i++) expect(slots[i]![0]).toBeLessThanOrEqual(X3_X_SPLIT);
      expect(PLANE_P.normal).toEqual([1, 0, 0]);
      expect(x3.events.map((e) => [e.type, e.tick])).toEqual([
        ['PARTITION_ON', X3_TICKS.PARTITION_ON], ['INJECT_SCORE', X3_TICKS.INJECT_A], ['INJECT_SCORE', X3_TICKS.INJECT_B], ['PARTITION_OFF', X3_TICKS.PARTITION_OFF],
      ]);
      const ticks = x3.events.map((e) => e.tick);
      expect([...ticks].sort((p, q) => p - q)).toEqual(ticks);
      expect(x3.events[0]).toMatchObject({ id: PARTITION_ID, point: PLANE_P.point, normal: PLANE_P.normal });
      expect(x3.events[3]).toMatchObject({ id: PARTITION_ID });
      // Distinct versions on one base; the later issuedTick is the last-writer-wins winner.
      expect(x3.versions.a).toEqual({ issuedTick: X3_TICKS.INJECT_A, origin: x3.targets.a });
      expect(x3.versions.b).toEqual({ issuedTick: X3_TICKS.INJECT_B, origin: x3.targets.b });
      expect(newerVersion(x3.versions.b, x3.versions.a)).toBe(true);
      expect(x3.versions.winner).toEqual(x3.versions.b);
      const injected = x3.events.filter((e) => e.type === 'INJECT_SCORE');
      // One base (limit 9 not exercised): composeNext keeps the movements current at the injection tick (EVAL's A)
      // and replaces what follows, so both injected scores start with the same EVAL movement.
      for (const e of injected) if (e.type === 'INJECT_SCORE') expect(e.score.movements[0]).toEqual(x3.score.movements[0]);
      const [ia, ib] = injected as Extract<typeof injected[number], { type: 'INJECT_SCORE' }>[];
      expect(ia!.score.movements.at(-1)!.recipe).toEqual({ kind: 'text', text: 'BRAVO' });
      expect(ib!.score.movements.at(-1)!.recipe).toEqual({ kind: 'text', text: 'DELTA' });
    });
  }

  it('is pure and deterministic: the same (seed, params) gives a deep-equal scenario, with no shared objects', () => {
    const params = makeParams(40);
    const a = buildX3(7, params);
    const b = buildX3(7, params);
    expect(a).toEqual(b);
    expect(a.events).not.toBe(b.events);
    expect(a.score).not.toBe(b.score);
  });

  it('the numeric churn cap is not chosen in code: it stays null until PHASE2_EVALUATION §6.1 registers it from dev seeds', () => {
    expect(X3_SLOT_CHANGES_CAP).toBeNull();
  });
});

describe.runIf(WIDE)('P2_WIDE: P2-T14 on X3, n0 40, one seed, Encore (and static for the capability row)', () => {
  it('every live drone ends on the later issuedTick; INV-CONVERGE holds; churn within the structural bound; deterministic', () => {
    const r = runX3(1, 40, 'encore');
    console.log(formatX3Row(r));
    expect(r.winner).toBe(`${X3_TICKS.INJECT_B}:${buildX3(1, makeParams(40)).targets.b}`);
    expect(r.liveEndOnWinner).toBe(r.liveEnd);
    expect(r.liveEnd).toBeGreaterThan(0);
    expect(r.invariants?.checked).toContain('INV-CONVERGE');
    expect(r.invariants?.counts['INV-CONVERGE']).toBe(0);
    expect(r.structuralOk).toBe(true);
    if (X3_SLOT_CHANGES_CAP !== null) expect(r.slotChanges ?? Infinity).toBeLessThanOrEqual(X3_SLOT_CHANGES_CAP);
    expect(runX3(1, 40, 'encore').stateHash).toBe(r.stateHash);
    // Static ignores injection by design (capability row, not a win): it never adopts either version.
    const s = runX3(1, 40, 'static');
    console.log(formatX3Row(s));
    expect(s.liveEndOnWinner).toBe(0);
  }, 600_000);
});
