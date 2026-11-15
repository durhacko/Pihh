// Score linter, checks L1-L5 (P2-WP-04; docs/design/ANIMATED_CHOREOGRAPHY_RFC.md section 9).
// Operator-side and authoring-time only: it never runs in a brain, the world or the observer.
// Pure and deterministic. It imports only src/contracts and src/score and no Node built-ins, so the app composer can
// bundle it (tests/cli/lint.test.ts asserts this).
//
// Two kinds of output, never mixed:
// - Structurally invalid input (a score, formation, transition or params the contracts do not allow) is REJECTED:
//   the entry points throw LintInputError and produce no findings.
// - Risk is WARNED: findings with severity 'info' or 'warn'. A finding never blocks injection and is never a
//   collision guarantee. L1 in particular counts predicted conflicts under ideal paced flight (no avoidance); it is
//   not a collision forecast (requirements section 5).
import { DT } from '../contracts';
import type { Formation, Params, Score, Vec3 } from '../contracts';
import { expandRecipe, launchPos } from '../score';

/**
 * RESTATED, not imported (src/agent may not be imported here): PACE_SETTLE_TICKS of src/agent/steer.ts, the 3 s
 * settle allowance of the paced-target rule (contract section 10, #96). tests/cli/lint.test.ts pins it to the
 * original and compares the restated pacing with pacedSlotPos. P2-WP-24 deletes this once pacing moves to src/score.
 */
export const PACE_SETTLE_TICKS = Math.round(3 / DT);

/** Contract section 6: bounds.min.y >= 2 m. */
export const MIN_ALTITUDE = 2;

/** How many worst pairs L1 lists. */
export const L1_WORST = 10;

/** The only wording L1 may use (requirements section 5). */
export const L1_LABEL = 'predicted conflicts under ideal paced flight (no avoidance) — not a collision forecast';

export type LintCheck = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type LintSeverity = 'info' | 'warn';

export interface LintPair {
  i: number;          // slot (= drone, under the static launch assignment) index, i < j
  j: number;
  dmin: number;       // metres, closest approach under ideal paced flight
  tick: number;       // begin + f* * span, not rounded
}

export interface LintFinding {
  check: LintCheck;
  severity: LintSeverity;
  count: number;             // the check's headline count (pairs, components, slots), 0 when clean
  detail: string;
  movement?: number;         // set by lintScore
  value?: number;            // the measured value the threshold applies to
  threshold?: number;
  countNear?: number;        // L1 only: pairs with dmin < dNear
  pairs?: LintPair[];
  slots?: number[];
}

/** Thrown for structurally invalid input. The input is rejected: no findings are produced for it. */
export class LintInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LintInputError';
  }
}

function reject(message: string): never {
  throw new LintInputError(message);
}

function isFiniteVec3(p: unknown): p is Vec3 {
  return Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function checkPoints(points: readonly Vec3[], what: string): void {
  if (!Array.isArray(points)) reject(`${what} must be an array of [x, y, z]`);
  for (let i = 0; i < points.length; i++) {
    if (!isFiniteVec3(points[i])) reject(`${what}[${i}] is not a finite [x, y, z]`);
  }
}

/** Rejects params the checks cannot interpret (thresholds missing, non-finite or non-positive). */
export function checkLintParams(params: Params): void {
  if (params === null || typeof params !== 'object') reject('params must be a Params object');
  for (const key of ['dCollide', 'dNear', 'rRadio', 'rClaim', 'vMax', 'slotSpacingMin'] as const) {
    const v = params[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) reject(`params.${key} must be a positive finite number, got ${String(v)}`);
  }
  if (!Number.isInteger(params.claimGap) || params.claimGap < 0) reject(`params.claimGap must be a non-negative integer, got ${String(params.claimGap)}`);
  if (!Number.isInteger(params.n0) || params.n0 < 1) reject(`params.n0 must be a positive integer, got ${String(params.n0)}`);
}

const d2 = (a: Vec3, b: Vec3): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// ---------------------------------------------------------------------------------------------------------------
// L1 closed form
// ---------------------------------------------------------------------------------------------------------------

/**
 * Closest approach of two drones that fly in step from a_i to b_i and a_j to b_j (same fraction f for both), with f
 * restricted to [0, fMax] (RFC 9.2). Returns dmin and the fraction f* where it occurs.
 */
export function closestApproach(ai: Vec3, bi: Vec3, aj: Vec3, bj: Vec3, fMax = 1): { dmin: number; f: number } {
  const r0x = aj[0] - ai[0], r0y = aj[1] - ai[1], r0z = aj[2] - ai[2];
  const Dx = (bj[0] - bi[0]) - r0x, Dy = (bj[1] - bi[1]) - r0y, Dz = (bj[2] - bi[2]) - r0z;
  const DD = Dx * Dx + Dy * Dy + Dz * Dz;
  let f = 0;
  if (DD > 0) {
    f = -(r0x * Dx + r0y * Dy + r0z * Dz) / DD;
    f = f > 0 ? (f < fMax ? f : fMax) : 0;
  }
  return { dmin: Math.hypot(r0x + f * Dx, r0y + f * Dy, r0z + f * Dz), f };
}

export interface TransitionOptions {
  begin?: number;   // tick at which f = 0, for the tick* of each pair; default 0
  fMax?: number;    // the flight is cut at this fraction (a later movement starts first); default 1
  movement?: number;
}

/**
 * L1 and L5 for one paced transition: every drone i flies in a straight line from from[i] to to[i] over spanTicks,
 * all at the same fraction. spanTicks <= 0 means the transition is not paced (drones target the slot directly):
 * L1 and L5 then report 'info: not paced, not evaluated'. Throws LintInputError for structurally invalid input.
 */
export function lintTransition(from: readonly Vec3[], to: readonly Vec3[], spanTicks: number, params: Params, options: TransitionOptions = {}): LintFinding[] {
  checkLintParams(params);
  checkPoints(from, 'from');
  checkPoints(to, 'to');
  if (from.length !== to.length) reject(`from has ${from.length} points but to has ${to.length}`);
  if (!Number.isInteger(spanTicks)) reject(`spanTicks must be an integer number of ticks, got ${String(spanTicks)}`);
  const begin = options.begin ?? 0;
  const fMax = options.fMax ?? 1;
  if (!Number.isFinite(begin)) reject(`begin must be finite, got ${String(begin)}`);
  if (!(fMax >= 0 && fMax <= 1)) reject(`fMax must be in [0, 1], got ${String(fMax)}`);
  const movement = options.movement;
  const tag = movement === undefined ? {} : { movement };

  if (spanTicks <= 0) {
    const detail = 'not paced, not evaluated: the pacing span is empty, so drones target the slot directly';
    return [
      { check: 'L1', severity: 'info', count: 0, detail, ...tag },
      { check: 'L5', severity: 'info', count: 0, detail, ...tag },
    ];
  }

  // L1: every pair, closed form.
  const n = from.length;
  const collide = params.dCollide;
  const near = params.dNear;
  let countCollide = 0;
  let countNear = 0;
  let worst: LintPair[] = [];
  let worstCut = Infinity;   // the L1_WORST-th smallest dmin so far, once the list is full
  for (let i = 0; i < n; i++) {
    const ai = from[i] as Vec3;
    const bi = to[i] as Vec3;
    for (let j = i + 1; j < n; j++) {
      const { dmin, f } = closestApproach(ai, bi, from[j] as Vec3, to[j] as Vec3, fMax);
      if (dmin < collide) countCollide++;
      if (dmin < near) countNear++;
      if (worst.length < L1_WORST || dmin < worstCut) {
        worst.push({ i, j, dmin, tick: begin + f * spanTicks });
        worst.sort(byDmin);
        if (worst.length > L1_WORST) worst = worst.slice(0, L1_WORST);
        if (worst.length === L1_WORST) worstCut = (worst[L1_WORST - 1] as LintPair).dmin;
      }
    }
  }
  const cut = fMax < 1 ? `; flight cut at f = ${fMax.toFixed(3)} by the next movement` : '';
  const l1: LintFinding = {
    check: 'L1',
    severity: countCollide > 0 ? 'warn' : 'info',
    count: countCollide,
    countNear,
    value: worst.length > 0 ? (worst[0] as LintPair).dmin : Infinity,
    threshold: collide,
    detail: `${countCollide} pairs below dCollide ${collide} m and ${countNear} below dNear ${near} m: ${L1_LABEL}${cut}`,
    pairs: worst,
    ...tag,
  };

  // L5: paced speed v_i = |b_i - a_i| / (span * DT) against 0.5 vMax.
  const limit = 0.5 * params.vMax;
  let vmax = 0;
  let worstSlot = -1;
  const over: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = Math.sqrt(d2(from[i] as Vec3, to[i] as Vec3)) / (spanTicks * DT);
    if (v > vmax) { vmax = v; worstSlot = i; }
    if (v > limit) over.push(i);
  }
  const l5: LintFinding = {
    check: 'L5',
    severity: over.length > 0 ? 'warn' : 'info',
    count: over.length,
    value: vmax,
    threshold: limit,
    detail: `max paced speed ${vmax.toFixed(2)} m/s (slot ${worstSlot}) against 0.5 vMax = ${limit} m/s; ${over.length} slots over`,
    slots: over,
    ...tag,
  };
  return [l1, l5];
}

function byDmin(a: LintPair, b: LintPair): number {
  return a.dmin - b.dmin || a.i - b.i || a.j - b.j;
}

// ---------------------------------------------------------------------------------------------------------------
// L2-L4 on one formation
// ---------------------------------------------------------------------------------------------------------------

function checkFormation(formation: Formation, params: Params): void {
  if (formation === null || typeof formation !== 'object' || !Array.isArray(formation.slots)) reject('formation must have a slots array');
  if (formation.slots.length !== params.n0) reject(`formation has ${formation.slots.length} slots but params.n0 is ${params.n0}`);
  formation.slots.forEach((s, i) => {
    if (s === null || typeof s !== 'object') reject(`slot ${i} is not an object`);
    if (s.index !== i) reject(`slot at position ${i} has index ${String(s.index)}; slots must be in priority order`);
    if (!isFiniteVec3(s.pos)) reject(`slot ${i} has no finite position`);
  });
  if (!Array.isArray(formation.dense)) reject('formation must have a dense array');
  checkPoints(formation.dense, 'dense');
}

/** L2 (radio graph), L3 (unhealable islands) and L4 (altitude) for a static formation. Throws LintInputError for invalid input. */
export function lintFormation(formation: Formation, params: Params, movement?: number): LintFinding[] {
  checkLintParams(params);
  checkFormation(formation, params);
  const tag = movement === undefined ? {} : { movement };
  const pos = formation.slots.map((s) => s.pos);
  const n = pos.length;
  const radio2 = params.rRadio * params.rRadio;
  const claim2 = params.rClaim * params.rClaim;

  // Adjacency for L2 and neighbour sets for L3 in one O(n^2) pass.
  const adj: number[][] = Array.from({ length: n }, () => []);
  const hasClaimNeighbour = new Array<boolean>(n).fill(false);
  const hasLowerClaimant = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dd = d2(pos[i] as Vec3, pos[j] as Vec3);
      if (dd <= radio2) { (adj[i] as number[]).push(j); (adj[j] as number[]).push(i); }
      if (dd <= claim2) {
        hasClaimNeighbour[i] = true;
        hasClaimNeighbour[j] = true;
        if (j > i + params.claimGap) hasLowerClaimant[i] = true;   // a drone on j may claim i: i + claimGap < j
      }
    }
  }

  // L2: components and hop diameter (max BFS eccentricity over components).
  const comp = new Array<number>(n).fill(-1);
  const sizes: number[] = [];
  const dist = new Array<number>(n).fill(-1);
  const queue = new Array<number>(n);
  let diameter = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] === -1) {
      let size = 0;
      comp[s] = sizes.length;
      let head = 0, tail = 0;
      queue[tail++] = s;
      while (head < tail) {
        const u = queue[head++] as number;
        size++;
        for (const v of adj[u] as number[]) if (comp[v] === -1) { comp[v] = sizes.length; queue[tail++] = v; }
      }
      sizes.push(size);
    }
    dist.fill(-1);
    dist[s] = 0;
    let head = 0, tail = 0;
    queue[tail++] = s;
    while (head < tail) {
      const u = queue[head++] as number;
      const du = dist[u] as number;
      if (du > diameter) diameter = du;
      for (const v of adj[u] as number[]) if (dist[v] === -1) { dist[v] = du + 1; queue[tail++] = v; }
    }
  }
  const sorted = [...sizes].sort((a, b) => b - a);
  const findings: LintFinding[] = [
    {
      check: 'L2',
      severity: sizes.length > 1 ? 'warn' : 'info',
      count: sizes.length,
      value: sizes.length,
      threshold: 1,
      detail: sizes.length > 1
        ? `${sizes.length} radio components (sizes ${sorted.join(', ')}) at rRadio ${params.rRadio} m: a score injected into one cannot reach another while the formation holds`
        : `one radio component of ${n} slots at rRadio ${params.rRadio} m`,
      ...tag,
    },
    {
      check: 'L2',
      severity: 'info',
      count: diameter,
      value: diameter,
      detail: `hop diameter ${diameter} (max BFS eccentricity over components): a lower bound on dissemination hops; slots stand in for drones`,
      ...tag,
    },
  ];

  // L3: islands, and the info line on slots no lower-priority neighbour can claim.
  const islands: number[] = [];
  const unclaimable: number[] = [];
  for (let v = 0; v < n; v++) {
    if (!hasClaimNeighbour[v]) islands.push(v);
    if (!hasLowerClaimant[v]) unclaimable.push(v);
  }
  findings.push({
    check: 'L3',
    severity: islands.length > 0 ? 'warn' : 'info',
    count: islands.length,
    detail: islands.length > 0
      ? `${islands.length} island slots with no other slot within rClaim ${params.rClaim} m: a drone lost there cannot be replaced (contract 8.5, limit 1)`
      : `no island slots at rClaim ${params.rClaim} m`,
    slots: islands,
    ...tag,
  });
  findings.push({
    check: 'L3',
    severity: 'info',
    count: unclaimable.length,
    detail: `${unclaimable.length} slots that no lower-priority neighbour (index > v + claimGap ${params.claimGap}) within rClaim can claim`,
    slots: unclaimable,
    ...tag,
  });

  // L4: static hold altitude over slots and the dense cloud.
  let minY = Infinity;
  const low: number[] = [];
  for (let v = 0; v < n; v++) {
    const y = (pos[v] as Vec3)[1];
    if (y < minY) minY = y;
    if (y < MIN_ALTITUDE) low.push(v);
  }
  let denseLow = 0;
  for (const p of formation.dense) {
    if (p[1] < minY) minY = p[1];
    if (p[1] < MIN_ALTITUDE) denseLow++;
  }
  findings.push({
    check: 'L4',
    severity: low.length > 0 || denseLow > 0 ? 'warn' : 'info',
    count: low.length,
    value: minY,
    threshold: MIN_ALTITUDE,
    detail: `minimum y ${minY.toFixed(2)} m over slots and dense against ${MIN_ALTITUDE} m; ${low.length} slots and ${denseLow} dense points below`,
    slots: low,
    ...tag,
  });
  return findings;
}

// ---------------------------------------------------------------------------------------------------------------
// Score transitions by the #96 pacing rule
// ---------------------------------------------------------------------------------------------------------------

export interface ScoreTransition {
  movement: number;
  paced: boolean;          // a paced flight that is actually flown at some tick >= 0
  /** Paced by the rule, but a later movement is current from `begin` on, so it is never flown (not linted). */
  superseded: boolean;
  reason: string | null;   // why not paced
  begin: number;           // max(startTick, 0)
  end: number;             // holdStart - PACE_SETTLE_TICKS (the paced point reaches the slot here)
  span: number;            // end - begin
  holdStart: number;
  /** The paced flight is cut when the next movement starts before `end`: f stops at (cutTick - begin) / span. */
  cutTick: number | null;
  from: Vec3[];            // launchPos for movement 0, else the previous movement's slots (same index)
  to: Vec3[];
}

/** Rejects a score whose structure the contracts do not allow. */
export function checkScoreStructure(score: Score, n0: number, params: Params): void {
  checkLintParams(params);
  if (!Number.isInteger(n0) || n0 < 1) reject(`n0 must be a positive integer, got ${String(n0)}`);
  if (params.n0 !== n0) reject(`n0 (${n0}) does not match params.n0 (${params.n0})`);
  if (score === null || typeof score !== 'object' || !Array.isArray(score.movements)) reject('score must have a movements array');
  const v = score.version as Partial<Score['version']> | undefined;
  if (v === null || typeof v !== 'object' || !Number.isInteger(v.issuedTick) || !Number.isInteger(v.origin)) {
    reject('score.version must be { issuedTick, origin } with integer fields');
  }
  if (score.movements.length === 0) reject('score has no movements');
  let prev = -Infinity;
  score.movements.forEach((m, k) => {
    if (m === null || typeof m !== 'object') reject(`movement ${k} is not an object`);
    if (!Number.isInteger(m.startTick)) reject(`movement ${k}: startTick must be an integer, got ${String(m.startTick)}`);
    if (!Number.isInteger(m.transitionTicks) || m.transitionTicks < 0) reject(`movement ${k}: transitionTicks must be a non-negative integer, got ${String(m.transitionTicks)}`);
    if (m.startTick < prev) reject(`movements must be sorted by startTick: movement ${k} starts at ${m.startTick}, before ${prev}`);
    prev = m.startTick;
    checkRecipe(m.recipe, k);
  });
}

const RECIPE_KINDS = ['text', 'sphere', 'helix'];

function checkRecipe(recipe: unknown, k: number): void {
  if (recipe === null || typeof recipe !== 'object') reject(`movement ${k} has no recipe`);
  const r = recipe as { kind?: unknown; text?: unknown; palette?: unknown };
  if (typeof r.kind !== 'string' || !RECIPE_KINDS.includes(r.kind)) reject(`movement ${k}: recipe kind must be one of ${RECIPE_KINDS.join(', ')}, got ${String(r.kind)}`);
  if (r.kind === 'text' && typeof r.text !== 'string') reject(`movement ${k}: a text recipe needs a text string`);
  if (r.palette !== undefined) {
    const ok = Array.isArray(r.palette) && r.palette.length === 2 && r.palette.every((c: unknown) =>
      Array.isArray(c) && c.length === 3 && c.every((x: unknown) => typeof x === 'number' && x >= 0 && x <= 1));
    if (!ok) reject(`movement ${k}: recipe palette must be two RGB triples in 0..1`);
  }
}

function slotsOf(score: Score, k: number, n0: number, params: Params): Vec3[] {
  try {
    return expandRecipe((score.movements[k] as Score['movements'][number]).recipe, n0, params).slots.map((s) => [s.pos[0], s.pos[1], s.pos[2]] as Vec3);
  } catch (e) {
    return reject(`movement ${k}: recipe cannot be expanded: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Every movement's transition by the #96 pacing rule (contract section 10): movement 0 is paced from launchPos only if
 * startTick <= 0; every later movement from the previous movement's slot of the same index. begin = max(startTick, 0),
 * end = holdStart - PACE_SETTLE_TICKS; not paced when end <= begin. Throws LintInputError for an invalid score.
 */
export function scoreTransitions(score: Score, n0: number, params: Params): ScoreTransition[] {
  checkScoreStructure(score, n0, params);
  const out: ScoreTransition[] = [];
  const movements = score.movements;
  for (let k = 0; k < movements.length; k++) {
    const m = movements[k] as Score['movements'][number];
    const holdStart = m.startTick + m.transitionTicks;
    const begin = Math.max(m.startTick, 0);
    const end = holdStart - PACE_SETTLE_TICKS;
    const span = end - begin;
    const to = slotsOf(score, k, n0, params);
    let paced = true;
    let reason: string | null = null;
    if (k === 0 && m.startTick > 0) { paced = false; reason = 'movement 0 starts after tick 0, so it is not paced (#96 rule)'; }
    else if (!(span > 0)) { paced = false; reason = `pacing span ${span} <= 0 ticks, so drones target the slot directly`; }
    let from: Vec3[];
    if (k === 0) {
      from = [];
      for (let id = 0; id < n0; id++) from.push(launchPos(id, n0));
    } else {
      from = slotsOf(score, k - 1, n0, params);
    }
    const next = movements[k + 1];
    let superseded = false;
    if (paced && next !== undefined && next.startTick <= begin) {
      // From `begin` on, a later movement is always the current one: this flight is never flown.
      paced = false;
      superseded = true;
      reason = `superseded by movement ${k + 1} (starts at ${next.startTick}) before its pacing begins`;
    }
    const cutTick = paced && next !== undefined && next.startTick < end ? next.startTick : null;
    out.push({ movement: k, paced, superseded, reason, begin, end, span, holdStart, cutTick, from, to });
  }
  return out;
}

/**
 * The restated paced target (contract section 10) for slot `slot` at `tick`: equal to pacedSlotPos of
 * src/agent/steer.ts, which tests/cli/lint.test.ts checks. Always a new array.
 */
export function pacedTarget(score: Score, tick: number, slot: number, n0: number, params: Params): Vec3 {
  const transitions = scoreTransitions(score, n0, params);
  let k = 0;
  for (let i = 1; i < score.movements.length; i++) if ((score.movements[i] as Score['movements'][number]).startTick <= tick) k = i;
  const t = transitions[k] as ScoreTransition;
  const to = t.to[slot];
  if (to === undefined) reject(`slot ${slot} does not exist for n0 = ${n0}`);
  // A superseded transition is still paced by the rule at ticks before `begin` (only negative ticks reach it).
  if (!(t.paced || t.superseded) || tick >= t.begin + t.span) return [to[0], to[1], to[2]];
  const from = t.from[slot] as Vec3;
  const f = Math.max(0, (tick - t.begin) / t.span);
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
}

export interface MovementLint {
  transition: ScoreTransition;
  findings: LintFinding[];   // L1 and L5 for the transition into this movement, then L2-L4 for its formation
}

/** L1-L5 for every movement of a score. Throws LintInputError (and lints nothing) if the score is invalid. */
export function lintScore(score: Score, n0: number, params: Params): MovementLint[] {
  return scoreTransitions(score, n0, params).map((t) => {
    let transitionFindings: LintFinding[];
    if (!t.paced) {
      const detail = `not paced, not evaluated: ${t.reason ?? ''}`;
      transitionFindings = [
        { check: 'L1', severity: 'info', count: 0, detail, movement: t.movement },
        { check: 'L5', severity: 'info', count: 0, detail, movement: t.movement },
      ];
    } else {
      const fMax = t.cutTick === null ? 1 : (t.cutTick - t.begin) / t.span;
      transitionFindings = lintTransition(t.from, t.to, t.span, params, { begin: t.begin, fMax, movement: t.movement });
    }
    const formation = expandRecipe((score.movements[t.movement] as Score['movements'][number]).recipe, n0, params);
    return { transition: t, findings: [...transitionFindings, ...lintFormation(formation, params, t.movement)] };
  });
}
