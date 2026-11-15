// Score linter L1-L5 (P2-WP-04): purity, pacing parity with src/agent/steer.ts, P2-T07 (closed form against brute force),
// L2-L5 unit cases, and rejection of structurally invalid input.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DT, makeParams, OPERATOR } from '../../src/contracts';
import type { Formation, Params, Recipe, Score, Vec3 } from '../../src/contracts';
import { composeNext, expandRecipe, launchPos } from '../../src/score';
import { PACE_SETTLE_TICKS as STEER_PACE_SETTLE_TICKS, pacedSlotPos } from '../../src/agent/steer';
import { buildEvalScore, RECIPE_INJECT } from '../../src/cli/scenarios';
import {
  closestApproach, L1_LABEL, LintInputError, lintFormation, lintScore, lintTransition, PACE_SETTLE_TICKS, pacedTarget, scoreTransitions,
} from '../../src/cli/lint';
import type { LintFinding } from '../../src/cli/lint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const N = 40;
const P40 = makeParams(N);
const EVAL40 = buildEvalScore(P40);

const find = (fs: LintFinding[], check: string, i = 0): LintFinding => fs.filter((f) => f.check === check)[i] as LintFinding;

function formationOf(points: Vec3[]): Formation {
  return {
    slots: points.map((pos, index) => ({ index, pos, colour: [1, 1, 1] })),
    dense: [],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

/** A deterministic stream for test cases (no Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('lint.ts purity', () => {
  it('imports only src/contracts and src/score, and uses no Node built-ins, process, require, window or document', () => {
    const file = 'src/cli/lint.ts';
    const source = readFileSync(resolve(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    const banned: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) banned.push('dynamic import');
      if (ts.isIdentifier(node) && ['require', 'process', 'window', 'document', 'Buffer', '__dirname'].includes(node.text)) banned.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(banned).toEqual([]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith('.'), spec).toBe(true);
      const target = relative(root, resolve(root, dirname(file), spec)).replaceAll('\\', '/');
      expect(['src/contracts', 'src/score'], spec).toContain(target);
    }
  });
});

describe('pacing parity with src/agent/steer.ts (restated, not imported)', () => {
  it('PACE_SETTLE_TICKS is pinned to the original', () => {
    expect(PACE_SETTLE_TICKS).toBe(STEER_PACE_SETTLE_TICKS);
  });

  const cases: [string, Score][] = [
    ['EVAL n0 40', EVAL40],
    ['S5 injected score (movement 0 is A, startTick -40: paced from launch)', composeNext(EVAL40, 400, RECIPE_INJECT, 3, N, P40)],
    ['a score injected during B (movement 0 starts at 900: not paced)', composeNext(EVAL40, 1000, RECIPE_INJECT, 3, N, P40)],
    ['a superseded movement 0 (both start before tick 0)', {
      version: { issuedTick: 0, origin: OPERATOR },
      movements: [
        { startTick: -100, transitionTicks: 400, recipe: { kind: 'sphere' } },
        { startTick: -50, transitionTicks: 400, recipe: { kind: 'helix' } },
      ],
    }],
    ['a score whose next movement cuts the flight, and an empty span', {
      version: { issuedTick: 0, origin: OPERATOR },
      movements: [
        { startTick: 0, transitionTicks: 400, recipe: { kind: 'sphere' } },
        { startTick: 200, transitionTicks: 300, recipe: { kind: 'helix' } },
        { startTick: 600, transitionTicks: 50, recipe: { kind: 'text', text: 'HI' } },
      ],
    }],
  ];
  it.each(cases)('pacedTarget equals pacedSlotPos at sampled ticks: %s', (_name, score) => {
    let compared = 0;
    for (let tick = -50; tick <= 1800; tick += 7) {
      for (let slot = 0; slot < N; slot += 3) {
        expect(pacedTarget(score, tick, slot, N, P40)).toEqual(pacedSlotPos(score, tick, slot, N, P40));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(3000);
  });

  it('scoreTransitions follows the #96 rule on EVAL: launch → A from launchPos, A → B from A, begin clipped to 0', () => {
    const [a, b] = scoreTransitions(EVAL40, N, P40);
    const mA = EVAL40.movements[0]!;
    const mB = EVAL40.movements[1]!;
    expect(a!.paced).toBe(true);
    expect(a!.begin).toBe(Math.max(mA.startTick, 0));
    expect(a!.end).toBe(mA.startTick + mA.transitionTicks - PACE_SETTLE_TICKS);
    expect(a!.from).toEqual(Array.from({ length: N }, (_, i) => launchPos(i, N)));
    expect(a!.from).toEqual(Array.from({ length: N }, (_, i) => pacedSlotPos(EVAL40, a!.begin, i, N, P40)));
    expect(b!.begin).toBe(mB.startTick);
    expect(b!.from).toEqual(expandRecipe(mA.recipe, N, P40).slots.map((s) => [...s.pos]));
    expect(b!.to).toEqual(expandRecipe(mB.recipe, N, P40).slots.map((s) => [...s.pos]));
    expect(a!.cutTick).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// P2-T07: closed form against brute force
// ---------------------------------------------------------------------------------------------------------------

const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
function gap(ai: Vec3, bi: Vec3, aj: Vec3, bj: Vec3, f: number): number {
  const p = lerp(ai, bi, f);
  const q = lerp(aj, bj, f);
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
}
/** Plain sampled minimum: `steps` + 1 evenly spaced fractions in [lo, hi]. */
function sampled(ai: Vec3, bi: Vec3, aj: Vec3, bj: Vec3, lo: number, hi: number, steps: number): { d: number; f: number } {
  let best = { d: Infinity, f: lo };
  for (let s = 0; s <= steps; s++) {
    const f = lo + ((hi - lo) * s) / steps;
    const d = gap(ai, bi, aj, bj, f);
    if (d < best.d) best = { d, f };
  }
  return best;
}
/** Brute force with no formula: 1000-step sampling, then twice more 1000 steps inside the bracket around the best sample. */
function bruteForce(ai: Vec3, bi: Vec3, aj: Vec3, bj: Vec3, fMax = 1): number {
  let lo = 0, hi = fMax;
  let best = { d: Infinity, f: 0 };
  for (let level = 0; level < 3; level++) {
    best = sampled(ai, bi, aj, bj, lo, hi, 1000);
    const h = (hi - lo) / 1000;
    [lo, hi] = [Math.max(0, best.f - h), Math.min(fMax, best.f + h)];
  }
  return best.d;
}
function relSpeed(ai: Vec3, bi: Vec3, aj: Vec3, bj: Vec3): number {
  return Math.hypot((bj[0] - aj[0]) - (bi[0] - ai[0]), (bj[1] - aj[1]) - (bi[1] - ai[1]), (bj[2] - aj[2]) - (bi[2] - ai[2]));
}

describe('P2-T07: L1 closed form against brute force', () => {
  const rand = lcg(201);
  const pt = (scale: number): Vec3 => [(rand() - 0.5) * scale, rand() * scale, (rand() - 0.5) * scale];
  const random: [Vec3, Vec3, Vec3, Vec3, number][] = [];
  for (let c = 0; c < 400; c++) {
    const scale = [1, 10, 60][c % 3] as number;
    const fMax = c % 5 === 0 ? 0.2 + 0.8 * rand() : 1;
    random.push([pt(scale), pt(scale), pt(scale), pt(scale), fMax]);
  }
  // Exact crossings, a parallel pair, a coincident pair and endpoint minima.
  random.push([[0, 5, 0], [10, 5, 0], [10, 5, 0], [0, 5, 0], 1]);
  random.push([[0, 5, 0], [10, 5, 0], [0, 6, 0], [10, 6, 0], 1]);
  random.push([[1, 5, 1], [1, 5, 1], [1, 5, 1], [1, 5, 1], 1]);
  random.push([[0, 5, 0], [1, 5, 0], [5, 5, 0], [9, 5, 0], 1]);

  it('random, crossing, parallel and cut pairs: closed form = refined 1000-step sampled minimum within 1e-6 m', () => {
    for (const [ai, bi, aj, bj, fMax] of random) {
      const closed = closestApproach(ai, bi, aj, bj, fMax).dmin;
      expect(Math.abs(closed - bruteForce(ai, bi, aj, bj, fMax))).toBeLessThan(1e-6);
    }
  });

  it('every pair of both EVAL transitions at n0 40: within 1e-6 m of the refined brute force, and the plain 1000-step minimum is within its sampling bound', () => {
    let pairs = 0;
    let maxPlainExcess = 0;
    for (const t of scoreTransitions(EVAL40, N, P40)) {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const [ai, bi, aj, bj] = [t.from[i]!, t.to[i]!, t.from[j]!, t.to[j]!];
          const closed = closestApproach(ai, bi, aj, bj).dmin;
          expect(Math.abs(closed - bruteForce(ai, bi, aj, bj))).toBeLessThan(1e-6);
          // Plain sampling can only overshoot the true minimum, by at most the relative path over half a step.
          const plain = sampled(ai, bi, aj, bj, 0, 1, 1000).d;
          expect(plain).toBeGreaterThanOrEqual(closed - 1e-12);
          expect(plain).toBeLessThanOrEqual(Math.hypot(closed, relSpeed(ai, bi, aj, bj) / 2000) + 1e-9);
          maxPlainExcess = Math.max(maxPlainExcess, plain - closed);
          pairs++;
        }
      }
    }
    expect(pairs).toBe(2 * (N * (N - 1)) / 2);
    expect(maxPlainExcess).toBeGreaterThanOrEqual(0);
  });

  it('L1 counts equal brute-force counts on EVAL at n0 40', () => {
    for (const t of scoreTransitions(EVAL40, N, P40)) {
      let collide = 0, near = 0;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const d = bruteForce(t.from[i]!, t.to[i]!, t.from[j]!, t.to[j]!);
          if (d < P40.dCollide) collide++;
          if (d < P40.dNear) near++;
        }
      }
      const l1 = find(lintTransition(t.from, t.to, t.span, P40, { begin: t.begin }), 'L1');
      expect(l1.count).toBe(collide);
      expect(l1.countNear).toBe(near);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// L1 and L5 unit cases
// ---------------------------------------------------------------------------------------------------------------

describe('L1: predicted conflicts under ideal paced flight (no avoidance)', () => {
  const P2 = makeParams(2);
  it('a head-on swap meets at f = 0.5: dmin 0 at begin + span / 2, a warn worded as not a collision forecast', () => {
    const fs = lintTransition([[0, 5, 0], [10, 5, 0]], [[10, 5, 0], [0, 5, 0]], 100, P2, { begin: 20 });
    const l1 = find(fs, 'L1');
    expect(l1.severity).toBe('warn');
    expect(l1.count).toBe(1);
    expect(l1.countNear).toBe(1);
    expect(l1.pairs).toEqual([{ i: 0, j: 1, dmin: 0, tick: 70 }]);
    expect(l1.detail).toContain(L1_LABEL);
    expect(L1_LABEL).toBe('predicted conflicts under ideal paced flight (no avoidance) — not a collision forecast');
  });
  it('parallel flight 1 m apart: no conflict, an info', () => {
    const l1 = find(lintTransition([[0, 5, 0], [0, 6, 0]], [[10, 5, 0], [10, 6, 0]], 100, P2), 'L1');
    expect(l1.severity).toBe('info');
    expect(l1.count).toBe(0);
    expect(l1.countNear).toBe(0);
    expect(l1.pairs?.[0]?.dmin).toBeCloseTo(1, 12);
  });
  it('a pair passing 0.6 m apart counts as near (< dNear 0.8) but not colliding (< dCollide 0.4)', () => {
    const l1 = find(lintTransition([[0, 5, 0], [10, 5.6, 0]], [[10, 5, 0], [0, 5.6, 0]], 100, P2), 'L1');
    expect(l1.count).toBe(0);
    expect(l1.countNear).toBe(1);
  });
  it('a flight cut by the next movement is evaluated only up to the cut', () => {
    const l1 = find(lintTransition([[0, 5, 0], [10, 5, 0]], [[10, 5, 0], [0, 5, 0]], 100, P2, { fMax: 0.25 }), 'L1');
    expect(l1.count).toBe(0);
    expect(l1.pairs?.[0]?.dmin).toBeCloseTo(5, 12);
    expect(l1.detail).toContain('cut at f = 0.250');
  });
  it('lists at most 10 worst pairs, by dmin then ids', () => {
    const from: Vec3[] = [];
    const to: Vec3[] = [];
    for (let i = 0; i < 12; i++) { from.push([i * 2, 5, 0]); to.push([i * 2, 5, 0]); }
    const l1 = find(lintTransition(from, to, 10, makeParams(12)), 'L1');
    expect(l1.pairs).toHaveLength(10);
    expect(l1.pairs?.[0]).toMatchObject({ i: 0, j: 1, dmin: 2 });
    expect(l1.pairs?.map((p) => p.dmin)).toEqual([...(l1.pairs ?? [])].map((p) => p.dmin).sort((a, b) => a - b));
  });
  it('an empty pacing span is info: not paced, not evaluated', () => {
    const fs = lintTransition([[0, 5, 0], [10, 5, 0]], [[10, 5, 0], [0, 5, 0]], 0, P2);
    expect(fs.map((f) => [f.check, f.severity, f.count])).toEqual([['L1', 'info', 0], ['L5', 'info', 0]]);
    expect(find(fs, 'L1').detail).toContain('not paced, not evaluated');
  });
  it('lintScore reports a movement 0 that starts after tick 0 as not paced', () => {
    const injected = composeNext(EVAL40, 1000, RECIPE_INJECT, 3, N, P40);   // movement 0 = B, startTick 900
    expect(injected.movements[0]!.startTick).toBeGreaterThan(0);
    const [m0, m1] = lintScore(injected, N, P40);
    expect(find(m0!.findings, 'L1')).toMatchObject({ severity: 'info', count: 0, movement: 0 });
    expect(find(m0!.findings, 'L1').detail).toContain('not paced');
    expect(m1!.transition.paced).toBe(true);
  });
  it('a movement superseded before its pacing begins is never flown: not paced, L1 and L5 info only', () => {
    for (const starts of [[0, 0], [-100, -50]]) {
      const score: Score = { version: { issuedTick: 0, origin: OPERATOR }, movements: [
        { startTick: starts[0]!, transitionTicks: 400, recipe: { kind: 'sphere' } },
        { startTick: starts[1]!, transitionTicks: 400, recipe: { kind: 'helix' } },
      ] };
      const [m0, m1] = lintScore(score, N, P40);
      expect(m0!.transition).toMatchObject({ paced: false, superseded: true, cutTick: null });
      expect(m0!.transition.reason).toContain('superseded by movement 1');
      expect(m0!.findings.filter((f) => f.check === 'L1' || f.check === 'L5').map((f) => f.severity)).toEqual(['info', 'info']);
      expect(m1!.transition.paced).toBe(true);
    }
  });
});

describe('L5: paced speed against 0.5 vMax', () => {
  const P2 = makeParams(2);
  it('warns on the slots over 4 m/s and reports the maximum', () => {
    // 100 ticks = 5 s: 20 m is exactly 4 m/s, 21 m is 4.2 m/s.
    const fs = lintTransition([[0, 5, 0], [0, 10, 0]], [[20, 5, 0], [21, 10, 0]], 100, P2);
    const l5 = find(fs, 'L5');
    expect(l5).toMatchObject({ severity: 'warn', count: 1, slots: [1], threshold: 4 });
    expect(l5.value).toBeCloseTo(21 / (100 * DT), 12);
  });
  it('exactly 0.5 vMax is not over', () => {
    expect(find(lintTransition([[0, 5, 0]], [[20, 5, 0]], 100, makeParams(1)), 'L5')).toMatchObject({ severity: 'info', count: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// L2-L4 unit cases
// ---------------------------------------------------------------------------------------------------------------

describe('L2: radio graph', () => {
  it('two islands 100 m apart: 2 components, a warn with their sizes', () => {
    const pts: Vec3[] = [[0, 30, 0], [3, 30, 0], [6, 30, 0], [100, 30, 0], [103, 30, 0]];
    const fs = lintFormation(formationOf(pts), makeParams(5));
    expect(find(fs, 'L2', 0)).toMatchObject({ severity: 'warn', count: 2 });
    expect(find(fs, 'L2', 0).detail).toContain('sizes 3, 2');
    expect(find(fs, 'L2', 1)).toMatchObject({ severity: 'info', count: 1 });   // each island is a clique at 15 m
  });
  it('a chain with links of exactly rRadio is one component with hop diameter n - 1', () => {
    const pts: Vec3[] = [0, 15, 30, 45, 60].map((x) => [x, 30, 0]);
    const fs = lintFormation(formationOf(pts), makeParams(5));
    expect(find(fs, 'L2', 0)).toMatchObject({ severity: 'info', count: 1 });
    expect(find(fs, 'L2', 1).count).toBe(4);
  });
  it('the hop diameter is the maximum eccentricity over all slots, not the eccentricity of slot 0', () => {
    const pts: Vec3[] = [30, 0, 15, 45, 60].map((x) => [x, 30, 0]);   // slot 0 sits mid-chain: eccentricity 2
    expect(find(lintFormation(formationOf(pts), makeParams(5)), 'L2', 1).count).toBe(4);
  });
});

describe('L3: unhealable islands', () => {
  it('a slot with no other slot within rClaim is an island; slots with no lower-priority claimant are listed', () => {
    const pts: Vec3[] = [[0, 30, 0], [1.5, 30, 0], [3, 30, 0], [13, 30, 0]];   // slot 3: 10 m away, inside rRadio, outside rClaim
    const params = makeParams(4, { claimGap: 1 });
    const fs = lintFormation(formationOf(pts), params);
    expect(find(fs, 'L3', 0)).toMatchObject({ severity: 'warn', count: 1, slots: [3] });
    // claimGap 1: slot v can be claimed from u > v + 1 within 6 m. Only slot 0 has one (slot 2).
    expect(find(fs, 'L3', 1)).toMatchObject({ severity: 'info', slots: [1, 2, 3] });
  });
  it('EVAL at n0 40 has no islands in either formation (as the RFC scratch run found at n0 200)', () => {
    for (const m of lintScore(EVAL40, N, P40)) expect(find(m.findings, 'L3', 0).count).toBe(0);
  });
});

describe('L4: altitude', () => {
  it('warns on slots below 2 m and on dense points below 2 m', () => {
    const f = formationOf([[0, 1.5, 0], [5, 3, 0]]);
    expect(find(lintFormation(f, makeParams(2)), 'L4')).toMatchObject({ severity: 'warn', count: 1, slots: [0], value: 1.5 });
    const g = { ...formationOf([[0, 3, 0], [5, 3, 0]]), dense: [[1, 1, 1]] as Vec3[] };
    expect(find(lintFormation(g, makeParams(2)), 'L4')).toMatchObject({ severity: 'warn', count: 0, value: 1 });
    expect(find(lintFormation(formationOf([[0, 2, 0], [5, 3, 0]]), makeParams(2)), 'L4').severity).toBe('info');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Rejection: invalid structure is rejected, never linted
// ---------------------------------------------------------------------------------------------------------------

describe('invalid structure is rejected (LintInputError), risk is only warned', () => {
  const P2 = makeParams(2);
  const sphere: Recipe = { kind: 'sphere' };
  const ok = (movements: Score['movements']): Score => ({ version: { issuedTick: 0, origin: OPERATOR }, movements });
  const bad: [string, () => unknown][] = [
    ['from and to of different lengths', () => lintTransition([[0, 0, 0]], [], 10, makeParams(1))],
    ['a NaN coordinate', () => lintTransition([[0, NaN, 0], [1, 1, 1]], [[0, 0, 0], [1, 1, 1]], 10, P2)],
    ['a point that is not [x, y, z]', () => lintTransition([[0, 0] as unknown as Vec3, [1, 1, 1]], [[0, 0, 0], [1, 1, 1]], 10, P2)],
    ['a fractional span', () => lintTransition([[0, 0, 0]], [[1, 0, 0]], 2.5, makeParams(1))],
    ['fMax outside [0, 1]', () => lintTransition([[0, 0, 0]], [[1, 0, 0]], 10, makeParams(1), { fMax: 1.5 })],
    ['dCollide 0', () => lintTransition([[0, 0, 0]], [[1, 0, 0]], 10, makeParams(1, { dCollide: 0 }))],
    ['a formation with the wrong slot count', () => lintFormation(formationOf([[0, 5, 0]]), P2)],
    ['slots out of priority order', () => lintFormation({ ...formationOf([[0, 5, 0], [3, 5, 0]]), slots: [{ index: 1, pos: [0, 5, 0], colour: [1, 1, 1] }, { index: 0, pos: [3, 5, 0], colour: [1, 1, 1] }] }, P2)],
    ['an empty score', () => lintScore(ok([]), N, P40)],
    ['movements not sorted by startTick', () => lintScore(ok([{ startTick: 100, transitionTicks: 10, recipe: sphere }, { startTick: 0, transitionTicks: 10, recipe: sphere }]), N, P40)],
    ['a negative transitionTicks', () => lintScore(ok([{ startTick: 0, transitionTicks: -1, recipe: sphere }]), N, P40)],
    ['a fractional startTick', () => lintScore(ok([{ startTick: 0.5, transitionTicks: 10, recipe: sphere }]), N, P40)],
    ['n0 that does not match params.n0', () => lintScore(EVAL40, 41, P40)],
    ['a recipe that cannot be expanded', () => lintScore(ok([{ startTick: 0, transitionTicks: 400, recipe: { kind: 'cube' } as unknown as Recipe }]), N, P40)],
    ['a text recipe without text', () => lintScore(ok([{ startTick: 0, transitionTicks: 400, recipe: { kind: 'text' } as unknown as Recipe }]), N, P40)],
    ['a malformed palette', () => lintScore(ok([{ startTick: 0, transitionTicks: 400, recipe: { kind: 'sphere', palette: 'red' } as unknown as Recipe }]), N, P40)],
    ['a score without a version', () => lintScore({ movements: EVAL40.movements } as unknown as Score, N, P40)],
    ['a formation without a dense array', () => lintFormation({ slots: formationOf([[0, 5, 0], [3, 5, 0]]).slots } as unknown as Formation, P2)],
  ];
  it.each(bad)('%s', (_name, run) => {
    expect(run).toThrow(LintInputError);
  });

  it('a valid but risky score is never rejected: EVAL at n0 40 lints, with findings only info or warn', () => {
    const all = lintScore(EVAL40, N, P40).flatMap((m) => m.findings);
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect(['info', 'warn']).toContain(f.severity);
    for (const f of all) expect(f.detail).not.toMatch(/will collide|guarantee|(?<!not a )collision forecast/i);
  });

  it('is deterministic: two runs give deep-equal output', () => {
    expect(lintScore(EVAL40, N, P40)).toEqual(lintScore(EVAL40, N, P40));
  });
});

describe.runIf(process.env.P2_PERF === '1')('P2_PERF: L2 BFS time at n0 200', () => {
  it('prints the time of lintFormation on both EVAL formations', () => {
    const params: Params = makeParams(200);
    const score = buildEvalScore(params);
    for (const m of score.movements) {
      const formation = expandRecipe(m.recipe, 200, params);
      const t0 = performance.now();
      lintFormation(formation, params);
      console.log(`lintFormation ${m.recipe.kind} n0 200: ${(performance.now() - t0).toFixed(1)} ms`);
    }
  });
});
