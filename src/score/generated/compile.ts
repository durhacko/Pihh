// src/score/generated/compile.ts
// GF-WP-06 (#212): compileGeneratedScene, the deterministic formation compiler (canonical spec
// docs/integrations/gemini-generated-formations.md §7.1, §7.4–§7.11). A scene becomes the existing
// Formation type: exactly n0 slots in farthest-point order (src/score/fps.ts), placed by P1 (the
// transform of src/score/expand.ts), with dense, bounds, typed warnings, stats and slotsDigest.
//
// Total (§7.11): every input gives { ok: true } or a typed rejection, never a throw, and the compiler
// never substitutes a formation itself (the fallback sphere is GF-WP-07's). It validates its input
// (validateScene, GF-WP-01) and compiles the canonical scene, so the hash names what was compiled.
//
// The formation and slotsDigest depend only on (scene, n0, slotSpacingMin). The confined-repair warnings
// of §8.11 also read rClaim and claimGap; they come from the separate repairWarnings(), which this calls
// when the params carry them, so a memo of the formation keyed on (sceneHash, n0, slotSpacingMin) stays valid.
//
// Pure and deterministic (§7.12): index-order iteration, ties to the lowest index, seeded streams from
// sceneHash (GF-WP-02), arithmetic and Math.sqrt as they are, other Math.* results snapped to 1e-9.
import { freeze } from '../expand';
import { farthestPointOrder } from '../fps';
import { sceneHash, slotsDigest } from './hashing';
import { checkPlacement, placeP1 } from './placement';
import { seededStream } from './prng';
import { foregroundRGB, sample2d, type Sample2DResult } from './sample2d';
import { sample3d } from './sample3d';
import { K_MIN, selectSlots, type SelectionCandidate, type SelectionOutcome, type SelectionPart, type SelectionPhase } from './selection';
import { buildRegion2D, checkConnectivity, rasterise, type Region2D } from './shapes2d';
import { buildSolids, type Warning3D } from './shapes3d';
import type { SceneSpec, SceneSpec2D, SceneSpec3D, Vec3 } from './types';
import { validateScene } from './validation';

/** Integer (CR-22). Bump on any change to the compiler's output for some scene; the goldens enforce it. */
export const COMPILER_VERSION = 1;

/**
 * Largest roster compiled. Spec §7.3 step 2: clamp(20·n0, 2,000, 5,000) candidates stay ≥ 4·n0 (the contract's
 * "about 4·n0", CR-06) only up to n0 = 1,250. The app's rosters are 100, 150 and 200 (main.ts); the CLI and tests
 * use others, so the spec's bound is the limit here.
 */
export const MAX_N0 = 1250;
/**
 * Smallest slotSpacingMin compiled, metres (interpretation: a sanity floor, far below any drone and the defaults'
 * rOcc 0.6 and dAvoid 1.4; it keeps world coordinates many 1e-6 digest steps apart).
 */
export const MIN_SLOT_SPACING = 0.1;

/**
 * §7.11 codes, plus the validation codes a non-V3-valid input can produce (parse, schema, too-large),
 * and dense-coverage for a result that would breach §7.8's slot-to-dense rule (spec differences, approved on #212).
 * unsupported-mode (2D before GF-WP-04) is gone: both modes compile.
 */
export type RejectCode =
  | 'parse' | 'schema' | 'too-large' | 'unsupported-version' | 'reference' | 'range' | 'geometry'
  | 'complexity' | 'empty-geometry' | 'too-few-candidates' | 'infeasible-count' | 'below-floor' | 'too-large-world'
  | 'dense-coverage' | 'internal';

export interface CompileWarning { code: string; partId?: string; detail: string }   // William used string[]

export interface CompileStats {
  candidates: { boundary: number; interior: number; feature: number; surface: number };
  perPart: Record<string, number>;     // selected slots per part id (a mirror copy is `<id>~m`)
  normalise: number;                   // uniform scale applied to the scene's union box before any threshold (§7.2)
  deltaFinal: number;                  // normalised spacing reached by selection (§7.4)
  scale: number;                       // metres per normalised unit (§7.6)
  size: Vec3;                          // world extent of bounds
  closestPair: number;                 // metres; slotSpacingMin·1.001 up to rounding
  simplifications: string[];           // which permitted simplifications ran (§7.11)
  hiddenFraction?: Record<string, number>;  // 3D: share of each part's candidates removed as interior
  /** 2D (added): the boundary quota q, its split per contour, and the boundary slots the quota step placed (§7.4 step 3). */
  boundary?: { quota: number; perContour: number[]; placed: number[] };
}

/** Structurally the contract's Formation (src/contracts/score.ts); src/score/generated does not import contracts. */
export interface GeneratedFormation {
  slots: { index: number; pos: Vec3; colour: [number, number, number] }[];
  dense: Vec3[];
  bounds: { min: Vec3; max: Vec3 };
}

export type CompileResult =
  | { ok: true; formation: GeneratedFormation; warnings: CompileWarning[]; sceneHash: string;
    compilerVersion: number; slotsDigest: string; stats: CompileStats }
  | { ok: false; code: RejectCode; detail: string; sceneHash: string | null;
    compilerVersion: number; warnings: CompileWarning[] };

/** The Params fields the compiler reads (structural; a full Params is accepted). */
export interface CompileParams {
  n0: number;
  slotSpacingMin: number;
  /** §8.11: only for repairWarnings; never changes the formation. */
  rClaim?: number;
  claimGap?: number;
}

const REJECT_CODES = new Set<string>(['parse', 'schema', 'too-large', 'unsupported-version', 'reference', 'range', 'geometry',
  'complexity', 'empty-geometry', 'internal']);
/** Validation issue codes outside §7.11's list: a colour out of range is a range failure. */
const MAPPED_CODES: Record<string, RejectCode> = { 'bad-colour': 'range' };

export function compileGeneratedScene(scene: SceneSpec, params: CompileParams, n0: number = params?.n0): CompileResult {
  const warnings: CompileWarning[] = [];
  let hash: string | null = null;
  const reject = (code: RejectCode, detail: string): CompileResult =>
    ({ ok: false, code, detail, sceneHash: hash, compilerVersion: COMPILER_VERSION, warnings });
  try {
    if (!Number.isInteger(n0) || n0 < 1 || n0 > MAX_N0) return reject('range', `n0 must be an integer in 1..${MAX_N0}, got ${String(n0)}`);
    const spacing = params?.slotSpacingMin;
    if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing < MIN_SLOT_SPACING) {
      return reject('range', `slotSpacingMin must be a finite number ≥ ${MIN_SLOT_SPACING} m, got ${String(spacing)}`);
    }
    const validated = validateScene(scene);
    if (!validated.ok) {
      const first = validated.errors[0];
      const code: RejectCode = MAPPED_CODES[first.code] ?? (REJECT_CODES.has(first.code) ? first.code as RejectCode : 'internal');
      return reject(code, validated.errors.map((e) => `${e.code} at ${e.path || '/'}: ${e.message}`).join('; '));
    }
    for (const w of validated.warnings) warnings.push({ code: w.code, detail: w.path ? `${w.message} (at ${w.path})` : w.message });
    const canonical = validated.scene;                 // already normalised (§6.7 steps 1–3); never the raw scene
    hash = sceneHash(canonical);
    return canonical.mode === 'scene3d'
      ? compile3D(canonical, hash, n0, spacing, params, warnings, reject)
      : compile2D(canonical, hash, n0, spacing, params, warnings, reject);
  } catch (error) {
    return reject('internal', `compiler invariant breached: ${String(error)}`);
  }
}

type Reject = (code: RejectCode, detail: string) => CompileResult;

function compile3D(
  scene: SceneSpec3D, hash: string, n0: number, spacing: number, params: CompileParams, warnings: CompileWarning[], reject: Reject,
): CompileResult {
  const stage: Warning3D[] = [];
  const solids = buildSolids(scene, stage);
  const sampled = sample3d(scene, solids, { n0, referenceView: scene.referenceView, stream: (label) => seededStream(hash, label) });
  warnings.push(...stage, ...sampled.warnings);
  const cands = sampled.candidates;

  const counts = solids.map(() => 0);
  for (const c of cands) counts[c.solid]++;
  const parts: SelectionPart[] = solids.map((s, i) => ({
    id: s.id, importance: s.importance, protected: s.importance >= 4, share: cands.length ? counts[i] / cands.length : 0,
  }));
  const input: SelectionCandidate[] = cands.map((c) => ({ pos: c.pos, part: c.solid, source: 'surface', importance: c.importance, visibility: c.visibility }));
  const selection = selectSlots({ mode: 'scene3d', candidates: input, parts, area: sampled.stats.exposedArea, n0 });
  if (!selection.ok) return reject(selection.code, selection.detail);
  if (selection.rear.selected < selection.rear.floor) {
    warnings.push({ code: 'rear-floor-unmet', detail: `${selection.rear.selected} of ${n0} slots face away from the reference view; the heuristic floor asks ${selection.rear.floor} (§7.3 step 5)` });
  }
  const used = new Set(selection.selected.map((c) => solids[cands[c].solid].materialId));
  return finish({
    mode: 'scene3d', hash, n0, spacing, params, warnings, reject, selection, dense: sampled.dense,
    pos: (c) => cands[c].pos, colour: (c) => cands[c].colour, part: (c) => cands[c].solid, parts,
    colourWarnings: scene.materials.filter((m) => used.has(m.id)).flatMap((m) => colourWarningsFor(m.rgb, `material ${m.id}`)),
    stats: { candidates: { boundary: 0, interior: 0, feature: 0, surface: cands.length }, normalise: sampled.stats.normalise, hiddenFraction: sampled.stats.hiddenFraction },
  });
}

/**
 * The 2D path (spec §7.2): region and mask (GF-WP-03), V8 connectivity with speck removal, then GF-WP-04's
 * candidates and dense. buildRegion2D throws RangeError only on input V3–V6 make impossible (ruling on #212): it is
 * the typed rejection geometry. share_f is the part's share of the interior lattice, which is area-uniform over the
 * cleaned mask, so it is the part's share of the filled area (interpretation: from the mask and region).
 */
function compile2D(
  scene: SceneSpec2D, hash: string, n0: number, spacing: number, params: CompileParams, warnings: CompileWarning[], reject: Reject,
): CompileResult {
  let region: Region2D;
  try {
    region = buildRegion2D(scene);
  } catch (error) {
    if (error instanceof RangeError) return reject('geometry', `the 2D region could not be built: ${error.message}`);
    throw error;
  }
  warnings.push(...region.warnings);
  const connectivity = checkConnectivity(rasterise(region), region);
  if (!connectivity.ok) return reject(connectivity.code, connectivity.detail);
  warnings.push(...connectivity.warnings);
  let sampled: Sample2DResult;
  try {
    sampled = sample2d(scene, region, connectivity.mask, { n0, next: seededStream(hash, 'interior') });
  } catch (error) {
    if (error instanceof RangeError) return reject('empty-geometry', `no 2D candidates: ${error.message}`);
    throw error;
  }
  const cands = sampled.candidates;
  const interior = region.parts.map(() => 0);
  let interiorTotal = 0;
  for (const c of cands) if (c.source === 'interior' && c.part >= 0) { interior[c.part]++; interiorTotal++; }
  const featureLength = new Map(sampled.features.map((f) => [f.part, f.length]));
  const parts: SelectionPart[] = region.parts.map((p, k) => ({
    id: p.id, importance: p.priority, protected: p.operation === 'union' && p.priority >= 4,
    share: interiorTotal ? interior[k] / interiorTotal : 0, featureLength: featureLength.get(k),
  }));
  const input: SelectionCandidate[] = cands.map((c) => ({ pos: c.pos, part: c.part, source: c.source, importance: c.importance, arc: c.arc }));
  const selection = selectSlots({
    mode: 'silhouette2d', candidates: input, parts, area: sampled.stats.filledArea, n0,
    contours: sampled.contours.map((c) => ({ length: c.length, first: c.first, count: c.count })),
  });
  if (!selection.ok) return reject(selection.code, selection.detail);
  const counts = sampled.stats.counts;
  return finish({
    mode: 'silhouette2d', hash, n0, spacing, params, warnings, reject, selection, dense: sampled.dense,
    pos: (c) => cands[c].pos, colour: (c) => cands[c].colour, part: (c) => cands[c].part, parts,
    colourWarnings: colourWarningsFor(foregroundRGB(scene.foreground), 'the foreground'),
    stats: { candidates: { boundary: counts.boundary, interior: counts.interior, feature: counts.feature, surface: 0 }, normalise: sampled.stats.normalise },
  });
}

interface Finish {
  mode: SceneSpec['mode'];
  hash: string; n0: number; spacing: number; params: CompileParams; warnings: CompileWarning[]; reject: Reject;
  selection: Extract<SelectionOutcome, { ok: true }>;
  dense: Vec3[];
  pos: (candidate: number) => Vec3;
  colour: (candidate: number) => readonly number[];
  /** Index into `parts` (−1 if no part owns the candidate). */
  part: (candidate: number) => number;
  parts: readonly SelectionPart[];
  colourWarnings: CompileWarning[];
  stats: Pick<CompileStats, 'candidates' | 'normalise' | 'hiddenFraction'>;
}

/** Shared by both modes: §7.5 order, §7.6 placement and checks, the §7.9 post-checks, colours, warnings, stats. */
function finish(f: Finish): CompileResult {
  const { selection, n0, spacing, warnings, reject } = f;
  // §7.5: farthest-point order over the selected set; slot 0 nearest its centroid.
  const unit = selection.selected.map((i) => f.pos(i));
  const order = farthestPointOrder(unit, n0).map((k) => selection.selected[k]);
  const placed = placeP1(order.map((i) => f.pos(i)), f.dense, spacing);
  const check = checkPlacement(placed);
  warnings.push(...check.warnings);
  if (!check.ok) return reject(check.code, check.detail);
  // §7.9 correctness requirements, checked on the result so the compiler never returns a breached ok: the closest
  // pair is at least slotSpacingMin (P1 makes it slotSpacingMin·1.001, so a breach is a bug: internal), and every
  // slot lies within slotSpacingMin of dense (§7.8; a breach is the typed rejection dense-coverage).
  if (placed.closestPair < spacing) return reject('internal', `closest pair ${placed.closestPair} m is below slotSpacingMin ${spacing} m after placement`);
  const coverage = denseCoverage(placed.slots, placed.dense);
  if (!(coverage.distance < spacing)) {
    return reject('dense-coverage', `slot ${coverage.slot} is ${Math.round(coverage.distance * 100) / 100} m from the nearest dense point; every slot must lie within slotSpacingMin = ${spacing} m of dense (§7.8, §7.9)`);
  }

  const slots = order.map((c, index) => ({ index, pos: placed.slots[index], colour: clampColour(f.colour(c)) }));
  const formation = freeze({ slots, dense: placed.dense, bounds: placed.bounds }) as GeneratedFormation;

  const perPart: Record<string, number> = {};
  for (const p of f.parts) perPart[p.id] = 0;
  for (const c of order) { const k = f.part(c); if (k >= 0) perPart[f.parts[k].id]++; }
  for (const p of f.parts) {
    if (p.protected && perPart[p.id] < K_MIN) {
      warnings.push({ code: 'feature-starved', partId: p.id, detail: `protected part ${p.id} has ${perPart[p.id]} slot${perPart[p.id] === 1 ? '' : 's'} (fewer than ${K_MIN})` });
    }
  }
  const simplifications = simplificationsOf(f.mode, selection.phase, warnings);
  warnings.push(...f.colourWarnings);
  const { rClaim, claimGap } = f.params;
  if (typeof rClaim === 'number' && Number.isFinite(rClaim) && rClaim > 0 && typeof claimGap === 'number' && Number.isFinite(claimGap) && claimGap > 0) {
    warnings.push(...repairWarnings(formation, rClaim, claimGap));
  } else {
    warnings.push({ code: 'repair-check-skipped', detail: `the §8.11 confined-repair check needs finite positive rClaim and claimGap (got ${String(rClaim)}, ${String(claimGap)}); the formation does not depend on them` });
  }

  const stats: CompileStats = {
    candidates: f.stats.candidates, perPart, normalise: f.stats.normalise, deltaFinal: selection.delta, scale: placed.scale,
    size: placed.size, closestPair: placed.closestPair, simplifications,
    ...(f.stats.hiddenFraction ? { hiddenFraction: f.stats.hiddenFraction } : {}),
    ...(f.mode === 'silhouette2d' ? { boundary: selection.boundary } : {}),
  };
  return { ok: true, formation, warnings, sceneHash: f.hash, compilerVersion: COMPILER_VERSION, slotsDigest: slotsDigest(formation, n0, spacing), stats };
}

/**
 * The slot farthest from the dense cloud and that distance (Infinity with no dense points); §7.8's rule is that it
 * stays below slotSpacingMin. Squared distances, one square root at the end.
 */
export function denseCoverage(slots: readonly Vec3[], dense: readonly Vec3[]): { slot: number; distance: number } {
  let worst = -1;
  let worst2 = -Infinity;
  for (let s = 0; s < slots.length; s++) {
    const p = slots[s];
    let near2 = Infinity;
    for (const q of dense) {
      const dx = p[0] - q[0];
      const dy = p[1] - q[1];
      const dz = p[2] - q[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < near2) near2 = d2;
    }
    if (near2 > worst2) { worst2 = near2; worst = s; }
  }
  return { slot: worst, distance: worst < 0 ? 0 : Math.sqrt(worst2) };
}

/**
 * §7.11: the permitted simplifications that ran, in order, each also as a warning. Steps 1–2 (drop specks, thicken)
 * and step 4 (boundary quota) exist only in 2D: shapes2d.ts emits speck-dropped and thickened, and only 2D has a
 * boundary quota, so the 3D path can record step 3 alone. The 2D branches serve the 2D path (GF-WP-04 plug-in).
 */
function simplificationsOf(mode: SceneSpec['mode'], phase: SelectionPhase, warnings: CompileWarning[]): string[] {
  const out: string[] = [];
  if (mode === 'silhouette2d' && warnings.some((w) => w.code === 'speck-dropped')) out.push('drop-specks');
  if (mode === 'silhouette2d' && warnings.some((w) => w.code === 'thickened')) out.push('thicken');
  if (phase !== 'full') {
    out.push('relax-reservations');
    warnings.push({ code: 'reservations-relaxed', detail: 'no spacing reached n0 with full reservations; protected reservations were relaxed to one slot each (§7.11 step 3)' });
  }
  if (phase === 'boundary-dropped') {
    out.push('drop-boundary-quota');
    warnings.push({ code: 'boundary-quota-dropped', detail: 'no spacing reached n0 with the boundary quota; it was relaxed to zero (§7.11 step 4)' });
  }
  return out;
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
const clampColour = (c: readonly number[]): [number, number, number] => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
const snap = (v: number): number => Math.round(v * 1e9) / 1e9;

/** sRGB-encoded channel to linear (§7.7, GF-CC-06); used only for the luminance warning until GF-D6. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : snap(((c + 0.055) / 1.055) ** 2.4);
}

/** Relative luminance of an sRGB-encoded colour, from its linear value. */
export function linearLuminance(rgb: readonly number[]): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/**
 * §7.7: the Composer's palette warnings (src/app/ui/Composer.ts validateDraft), on the sRGB-encoded scene colour,
 * plus the luminance warning on the linear value. Once per distinct colour: the 2D foreground or each 3D material.
 */
export function colourWarningsFor(rgb: readonly number[], name: string): CompileWarning[] {
  const [r, g, b] = rgb;
  const out: CompileWarning[] = [];
  if (r > 0.92 && g > 0.92 && b > 0.92) out.push({ code: 'reserved-colour', detail: `${name} is near white, which is reserved for selection and deaf markers; it may read as a diagnostic` });
  else if (r > 0.9 && g > 0.25 && g < 0.45 && b < 0.2) out.push({ code: 'reserved-colour', detail: `${name} is near vermilion, which is reserved for vacant slots and jams` });
  else if (b > 0.75 && r < 0.25 && g < 0.35) out.push({ code: 'dim-colour', detail: `${name} is pure blue, which renders dim against the night sky` });
  if (linearLuminance(rgb) < 0.02) out.push({ code: 'dark-light-may-vanish', detail: `${name} has linear luminance below 0.02; dark lights may vanish against the night sky` });
  return out;
}


/** One slot-graph component (edges ≤ rClaim), indices ascending. */
export interface RepairComponent { size: number; lowest: number; highest: number }

export interface RepairReport {
  components: RepairComponent[];   // largest first, then by lowest index
  confinedSlots: number;           // slots outside the largest component
  islandSlots: number;             // slots alone in their component (the per-slot L3 subset)
  warnings: CompileWarning[];
}

/**
 * §8.11 confined repair, the component form of L3: components of the placed slots with edges ≤ rClaim. Every
 * component but the largest is "repair confined"; one with fewer than claimGap + 2 slots, or no index gap above
 * claimGap (max − min ≤ claimGap), also "cannot heal internally" (a claim needs v + claimGap < own slot).
 */
export function repairReport(formation: Pick<GeneratedFormation, 'slots'>, rClaim: number, claimGap: number): RepairReport {
  const slots = formation.slots;
  const n = slots.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const r2 = rClaim * rClaim;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = slots[i].pos;
      const b = slots[j].pos;
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      if (dx * dx + dy * dy + dz * dz <= r2) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = byRoot.get(root);
    if (list) list.push(slots[i].index); else byRoot.set(root, [slots[i].index]);
  }
  const components = [...byRoot.values()]
    .map((ids) => { ids.sort((a, b) => a - b); return { size: ids.length, lowest: ids[0], highest: ids[ids.length - 1] }; })
    .sort((a, b) => b.size - a.size || a.lowest - b.lowest);
  const warnings: CompileWarning[] = [];
  let confinedSlots = 0;
  for (const c of components.slice(1)) {
    confinedSlots += c.size;
    warnings.push({ code: 'repair-confined', detail: `a component of ${c.size} slot${c.size === 1 ? '' : 's'} (lowest index ${c.lowest}) lies beyond rClaim = ${rClaim} m of the rest: holes cannot leave this component` });
    if (c.size < claimGap + 2 || c.highest - c.lowest <= claimGap) {
      warnings.push({ code: 'cannot-heal-internally', detail: `the component with lowest index ${c.lowest} (${c.size} slots, indices ${c.lowest}…${c.highest}) has no index gap above claimGap = ${claimGap}` });
    }
  }
  return { components, confinedSlots, islandSlots: components.filter((c) => c.size === 1).length, warnings };
}

/** The §8.11 warnings alone (what compileGeneratedScene appends when the params carry rClaim and claimGap). */
export function repairWarnings(formation: Pick<GeneratedFormation, 'slots'>, rClaim: number, claimGap: number): CompileWarning[] {
  return repairReport(formation, rClaim, claimGap).warnings;
}
