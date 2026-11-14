// tests/g4/relay.test.ts
// T18 (docs/validation/evaluation-and-tests.md): score relay on the real world. Three drones in a line, A in radio
// range of B, B in range of C, A out of range of C; the operator injects at A. C adopts within 40 ticks at loss 0,
// and within 400 ticks at loss 0.2 on seeds 1-5. Same bounds with two extra up-to-date drones beside B that cannot
// reach C (hidden terminal): B must not stand down because it heard them (contract section 9: a scheduled send
// always fires). No drone sends more than one SCORE per scoreResendMin.
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { Recipe, Vec3 } from '../../src/contracts';
import { composeNext, makeScore } from '../../src/score';
import { dist, minSendGap, pinnedEncore, run } from './harness';

const A = 0, B = 1, C = 2, D = 3, E = 4;
const Y = 20;
// rRadio is 15 m (default). A-B 10, B-C 10, A-C 20: only B can reach C.
const LINE: Vec3[] = [[0, Y, 0], [10, Y, 0], [20, Y, 0]];
// D and E sit beside B: within range of A (7.07 m) and of B (7.07 m), out of range of C (15.8 m).
const HIDDEN: Vec3[] = [...LINE, [5, Y, 5], [5, Y, -5]];
const INJECT = 200;                     // all drones have reached their pins long before
const NEW_RECIPE: Recipe = { kind: 'text', text: 'C' };

function relay(pins: Vec3[], loss: number, seed: number) {
  const params = makeParams(pins.length, { loss });
  const pre = makeScore([{ kind: 'sphere' }], pins.length, params);
  const next = composeNext(pre, INJECT, NEW_RECIPE, A, pins.length, params);
  const r = run({
    seed, params, score: pre, brain: pinnedEncore(pins), ticks: INJECT + 450,
    events: [{ type: 'INJECT_SCORE', tick: INJECT, droneId: A, score: next }],
    watch: next.version,
  });
  return { r, params, next };
}

/** Ticks from injection to adoption by drone `id` (Infinity if never). */
const delay = (adopted: (number | null)[], id: number): number => (adopted[id] === null ? Infinity : (adopted[id] as number) - INJECT);

describe('T18: score relay on the real world', () => {
  it('the geometry is what the test claims: A-B and B-C within rRadio, A-C, D-C and E-C beyond it', () => {
    const rRadio = makeParams(5).rRadio;
    expect(dist(HIDDEN[A], HIDDEN[B])).toBeLessThan(rRadio);
    expect(dist(HIDDEN[B], HIDDEN[C])).toBeLessThan(rRadio);
    expect(dist(HIDDEN[A], HIDDEN[C])).toBeGreaterThan(rRadio);
    for (const x of [D, E]) {
      expect(dist(HIDDEN[x], HIDDEN[A])).toBeLessThan(rRadio);
      expect(dist(HIDDEN[x], HIDDEN[B])).toBeLessThan(rRadio);
      expect(dist(HIDDEN[x], HIDDEN[C])).toBeGreaterThan(rRadio);
    }
  });

  for (const [name, pins] of [['line A-B-C', LINE], ['hidden terminal (D, E beside B)', HIDDEN]] as const) {
    describe(name, () => {
      it('loss 0: C adopts within 40 ticks; only B ever delivers a SCORE to C; at most one SCORE per drone per scoreResendMin', () => {
        const times: string[] = [];
        for (const seed of [1, 2, 3, 4, 5]) {
          const { r, params } = relay([...pins], 0, seed);
          const c = delay(r.adopted, C);
          times.push(`seed ${seed}: B ${delay(r.adopted, B)}, C ${c}`);
          expect(c, `seed ${seed}`).toBeLessThanOrEqual(40);
          // The drones really sat where the test says: nobody but B reached C.
          for (const s of r.sends) if (s.delivered.includes(C)) expect(s.from, `seed ${seed} tick ${s.tick}`).toBe(B);
          expect(r.sends.some((s) => s.from === B && s.delivered.includes(C))).toBe(true);
          expect(minSendGap(r.sends)).toBeGreaterThanOrEqual(params.scoreResendMin);
          // Everyone ends on the injected version.
          for (const v of r.finalVersions) expect(v).toEqual({ issuedTick: INJECT, origin: A });
        }
        console.log(`T18 ${name}, loss 0, adoption ticks after injection: ${times.join('; ')}`);
      }, 30_000);

      it('loss 0.2: C adopts within 400 ticks on seeds 1-5; at most one SCORE per drone per scoreResendMin', () => {
        const times: string[] = [];
        for (const seed of [1, 2, 3, 4, 5]) {
          const { r, params } = relay([...pins], 0.2, seed);
          const c = delay(r.adopted, C);
          times.push(`seed ${seed}: B ${delay(r.adopted, B)}, C ${c}`);
          expect(c, `seed ${seed}`).toBeLessThanOrEqual(400);
          for (const s of r.sends) if (s.delivered.includes(C)) expect(s.from).toBe(B);
          expect(minSendGap(r.sends)).toBeGreaterThanOrEqual(params.scoreResendMin);
        }
        console.log(`T18 ${name}, loss 0.2, adoption ticks after injection: ${times.join('; ')}`);
      }, 30_000);
    });
  }
});
