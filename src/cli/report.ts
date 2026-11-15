// src/cli/report.ts
// The Markdown results table (evaluation doc §5 step 4): per scenario and metric, median and IQR per arm,
// median paired delta (Encore - static), win/tie/loss on npwcEnd by the ±0.02 rule, censored tRec count,
// worst seed. Losses stay in the table, marked LOSS (§1). Pure: records in, Markdown out.
// A static and an Encore record are paired only when they are a fair pair (§4): same scenario, n0 and seed,
// AND the same git, paramsHash and events. Anything else is shown as MISMATCH and never counted.
import type { RunRecord } from '../contracts';
import { canonicalJson } from './run';

export const WIN_MARGIN = 0.02;
export type Verdict = 'WIN' | 'TIE' | 'LOSS';

/** Summary keys in the order of the evaluation doc §2; any other keys follow alphabetically. */
export const METRIC_ORDER = [
  'npwcEnd', 'npwcEndA', 'coverageEnd', 'sfMeanEnd', 'sfMaxEnd', 'sfMaxEndA', 'capacityLoss', 'coordLoss',
  'tRec', 'npwcDeficitSec', 'slotChanges', 'slotChangesMaxDrone', 'lateSlotChanges', 'dupSlotSec', 'dupSlotsEnd',
  'collisions', 'nearMisses', 'msgsPerDroneSec', 'deliveryRatio', 'adoptP50', 'adoptMax', 'unadopted',
  'splitSec', 'tVersion',
] as const;

/** Scenarios with no win/tie/loss: static cannot adopt an injected score (evaluation doc §3, S5). */
const NO_VERDICT: Record<string, string> = {
  S5: 'no win/tie/loss: static cannot adopt an injected score (capability difference, see `unadopted`)',
};

/** Win if Δ > +0.02, loss if Δ < −0.02, else tie (evaluation doc §3). */
export function verdict(delta: number): Verdict {
  if (delta > WIN_MARGIN) return 'WIN';
  if (delta < -WIN_MARGIN) return 'LOSS';
  return 'TIE';
}

/**
 * Quantile with linear interpolation between order statistics (R type 7, numpy default). +Infinity is allowed
 * (a censored tRec): interpolating towards it gives +Infinity, landing exactly on a finite value gives that value.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const a = sorted[lo] as number;
  if (h === lo) return a;
  const b = sorted[lo + 1] as number;
  if (b === Infinity) return Infinity;   // also avoids Infinity - Infinity = NaN
  return a + (h - lo) * (b - a);
}

export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

export interface Stats { n: number; median: number | null; q1: number | null; q3: number | null; nulls: number }

/**
 * Median and IQR of one metric over one arm. Nulls are skipped (counted in `nulls`), except with
 * `censoredHigh` (tRec): a null is a seed that never recovered, so it ranks above every recovered seed
 * (+Infinity) instead of being dropped, which would flatter the median.
 */
export function stats(values: readonly (number | null)[], censoredHigh = false): Stats {
  const nulls = values.filter((v) => v === null).length;
  const nums = censoredHigh
    ? values.map((v) => (v === null ? Infinity : v))
    : values.filter((v): v is number => v !== null);
  return { n: nums.length, median: median(nums), q1: quantile(nums, 0.25), q3: quantile(nums, 0.75), nulls };
}

/** Metrics whose null means "censored, ranks worst" rather than "not applicable". */
const CENSORED_HIGH = new Set(['tRec']);

/** A number for the table. Integers print bare unless `decimals` asks for 3 places (to match the rest of a row). */
function fmt(x: number | null, decimals = false): string {
  if (x === null) return '—';
  if (x === Infinity) return 'censored';
  if (!decimals && Number.isInteger(x)) return String(x);
  if (Math.abs(x) < 0.0005) return '0.000';   // no "-0.000" from floating-point noise
  return x.toFixed(3);
}

/**
 * What a null summary value means: for tRec, "not recovered" (censored); for every other key, "not applicable"
 * (e.g. npwcDeficitSec before any event, deliveryRatio with no messages). '—' means no record had the key.
 */
function nullLabel(key: string): string {
  return key === 'tRec' ? 'censored' : 'n/a';
}

function fmtStats(s: Stats, key: string, decimals = false): string {
  // For a censored-high metric n counts the censored values too; otherwise n excludes nulls.
  const allNull = CENSORED_HIGH.has(key) ? s.n === s.nulls : s.n === 0;
  if (allNull) return s.nulls > 0 ? `${nullLabel(key)} ×${s.nulls}` : '—';
  const nulls = s.nulls > 0 ? `, ${nullLabel(key)} ×${s.nulls}` : '';
  return `${fmt(s.median, decimals)} [${fmt(s.q1, decimals)}–${fmt(s.q3, decimals)}] (n=${s.n}${nulls})`;
}

function orderedKeys(records: readonly RunRecord[]): string[] {
  const present = new Set<string>();
  for (const r of records) for (const k of Object.keys(r.summary)) present.add(k);
  const known = METRIC_ORDER.filter((k) => present.has(k));
  const extra = [...present].filter((k) => !(METRIC_ORDER as readonly string[]).includes(k)).sort();
  return [...known, ...extra];
}

function value(r: RunRecord | undefined, key: string): number | null | undefined {
  if (r === undefined || !(key in r.summary)) return undefined;
  return r.summary[key] ?? null;
}

export interface Group { scenario: string; n0: number; static: Map<number, RunRecord>; encore: Map<number, RunRecord> }

function groupRecords(records: readonly RunRecord[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of records) {
    const key = `${r.scenario}\u0000${r.n0}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { scenario: r.scenario, n0: r.n0, static: new Map(), encore: new Map() };
      groups.set(key, g);
    }
    const arm = g[r.arm];
    if (arm.has(r.seed)) throw new Error(`Two records for ${r.scenario} n0=${r.n0} ${r.arm} seed ${r.seed}`);
    arm.set(r.seed, r);
  }
  return [...groups.values()].sort((a, b) => a.scenario.localeCompare(b.scenario) || b.n0 - a.n0);
}

/**
 * 'paired': both arms present and a fair pair (same git, paramsHash and events, §4).
 * 'mismatch': both present but not a fair pair. 'unpaired': one arm missing.
 */
export type PairStatus = 'paired' | 'mismatch' | 'unpaired';

/** True only if the two records differ in nothing but the brain: same git, paramsHash and events. */
export function fairPair(a: RunRecord, b: RunRecord): boolean {
  return a.git === b.git && a.paramsHash === b.paramsHash && canonicalJson(a.events) === canonicalJson(b.events);
}

export function pairStatus(group: Group, seed: number): PairStatus {
  const s = group.static.get(seed);
  const e = group.encore.get(seed);
  if (s === undefined || e === undefined) return 'unpaired';
  return fairPair(s, e) ? 'paired' : 'mismatch';
}

export interface SeedRow {
  seed: number; status: PairStatus;
  static: number | null | undefined; encore: number | null | undefined;
  delta: number | null;            // only for a fair pair with both values numeric
  verdict: Verdict | null;         // null: not a fair pair, a value missing, or a scenario with no verdicts
}

/** Per-seed npwcEnd rows. Only fair pairs get a delta and a verdict. */
export function npwcRows(group: Group): SeedRow[] {
  const seeds = [...new Set([...group.static.keys(), ...group.encore.keys()])].sort((a, b) => a - b);
  return seeds.map((seed) => {
    const status = pairStatus(group, seed);
    const s = value(group.static.get(seed), 'npwcEnd');
    const e = value(group.encore.get(seed), 'npwcEnd');
    const delta = status === 'paired' && typeof s === 'number' && typeof e === 'number' ? e - s : null;
    const v = delta !== null && NO_VERDICT[group.scenario] === undefined ? verdict(delta) : null;
    return { seed, status, static: s, encore: e, delta, verdict: v };
  });
}

/** Encore − static per fair pair where both values are numbers. Mismatched and unpaired seeds are excluded. */
function pairedDeltas(group: Group, key: string): number[] {
  const out: number[] = [];
  for (const [seed, s] of group.static) {
    if (pairStatus(group, seed) !== 'paired') continue;
    const a = value(s, key);
    const b = value(group.encore.get(seed), key);
    if (typeof a === 'number' && typeof b === 'number') out.push(b - a);
  }
  return out;
}

function censored(arm: Map<number, RunRecord>): string {
  if (arm.size === 0) return 'no records';
  let withKey = 0;
  let nulls = 0;
  for (const r of arm.values()) {
    if ('tRec' in r.summary) {
      withKey++;
      if (r.summary.tRec === null) nulls++;
    }
  }
  return withKey === 0 ? 'n/a (no KILL)' : `${nulls} of ${withKey}`;
}

function renderGroup(g: Group): string[] {
  const all = [...g.static.values(), ...g.encore.values()];
  const rows = npwcRows(g);
  const pairs = rows.filter((r) => r.status === 'paired').length;
  const mismatched = rows.filter((r) => r.status === 'mismatch').length;
  const unpaired = rows.filter((r) => r.status === 'unpaired').length;
  const out: string[] = [];
  out.push(`### ${g.scenario} (n0 = ${g.n0})`, '');
  out.push(`Seeds: static ${g.static.size}, encore ${g.encore.size}, fair pairs ${pairs}, mismatched ${mismatched}, unpaired ${unpaired}. Pass lines "out of 20" scale to the fair-pair count.`, '');

  // Win/tie/loss on npwcEnd, one row per seed, losses kept and marked.
  const noVerdict = NO_VERDICT[g.scenario];
  const counts = { WIN: 0, TIE: 0, LOSS: 0 };
  for (const r of rows) if (r.verdict) counts[r.verdict]++;
  out.push(noVerdict ? `npwcEnd per seed (${noVerdict}):` : `npwcEnd per seed, Δ = Encore − static, win if Δ > +${WIN_MARGIN}, loss if Δ < −${WIN_MARGIN}:`, '');
  out.push('| Seed | static | encore | Δ | Verdict |', '|---:|---:|---:|---:|---|');
  for (const r of rows) {
    const label = r.status === 'mismatch' ? '**MISMATCH** (git, params or events differ: not counted)'
      : r.status === 'unpaired' ? 'UNPAIRED'
        : r.verdict === 'LOSS' ? '**LOSS**'
          : r.verdict ?? 'n/a';
    out.push(`| ${r.seed} | ${fmt(r.static ?? null)} | ${fmt(r.encore ?? null)} | ${fmt(r.delta)} | ${label} |`);
  }
  out.push('');
  if (!noVerdict) {
    const counted = counts.WIN + counts.TIE + counts.LOSS;
    const noValue = pairs - counted;
    out.push(`Win/tie/loss: **${counts.WIN} / ${counts.TIE} / ${counts.LOSS}** of ${pairs} fair pairs. ` +
      `No verdict: ${rows.length - counted} seeds (${mismatched} mismatched, ${unpaired} unpaired, ${noValue} with a null npwcEnd).`);
  }
  const paired = rows.filter((r) => r.delta !== null);
  if (paired.length > 0) {
    const worst = paired.reduce((w, r) => ((r.delta as number) < (w.delta as number) ? r : w));
    out.push(`Worst seed (lowest Δ npwcEnd): seed ${worst.seed}, Δ ${fmt(worst.delta)}.`);
  } else {
    for (const arm of ['static', 'encore'] as const) {
      const vals = [...g[arm].values()].map((r) => ({ seed: r.seed, v: value(r, 'npwcEnd') })).filter((x): x is { seed: number; v: number } => typeof x.v === 'number');
      if (vals.length > 0) {
        const w = vals.reduce((a, b) => (b.v < a.v ? b : a));
        out.push(`Worst seed (${arm}, lowest npwcEnd, no pairs): seed ${w.seed}, ${fmt(w.v)}.`);
      }
    }
  }
  out.push(`tRec censored (not recovered): static ${censored(g.static)}, encore ${censored(g.encore)}.`, '');

  // Every summary metric.
  out.push('| Metric | static median [IQR] | encore median [IQR] | median Δ (E − S) |', '|---|---|---|---|');
  for (const key of orderedKeys(all)) {
    const high = CENSORED_HIGH.has(key);
    const s = stats([...g.static.values()].map((r) => value(r, key)).filter((v): v is number | null => v !== undefined), high);
    const e = stats([...g.encore.values()].map((r) => value(r, key)).filter((v): v is number | null => v !== undefined), high);
    const d = pairedDeltas(g, key);
    const md = median(d);
    // One format per row: if any shown value has a fraction, every value gets 3 decimals ("4.000 [4.000–4.000]", not "4.000 [4.000–4]").
    const shown = [s.median, s.q1, s.q3, e.median, e.q1, e.q3, md].filter((v): v is number => v !== null && Number.isFinite(v));
    const dec = shown.some((v) => !Number.isInteger(v));
    out.push(`| \`${key}\` | ${fmtStats(s, key, dec)} | ${fmtStats(e, key, dec)} | ${d.length ? `${fmt(md, dec)} (${d.length} pairs)` : '—'} |`);
  }
  out.push('');
  return out;
}

/** The Markdown results table for a set of RunRecords. */
export function buildReport(records: readonly RunRecord[]): string {
  const out: string[] = ['# Evaluation results', ''];
  if (records.length === 0) return [...out, 'No run records.', ''].join('\n');
  const gits = [...new Set(records.map((r) => r.git))].sort();
  const hashes = [...new Set(records.map((r) => r.paramsHash))].sort();
  out.push(`Records: ${records.length}. git: ${gits.map((g) => `\`${g}\``).join(', ')}. paramsHash: ${hashes.map((h) => `\`${h.slice(0, 12)}\``).join(', ')}.`);
  if (gits.length > 1 || hashes.length > 1) out.push('', '**WARNING: records come from more than one commit or parameter set; they are not one frozen revision (§5).**');
  out.push('', 'Medians and IQRs skip null values, counted separately: `n/a` = not applicable (e.g. `npwcDeficitSec` with no event), `—` = key absent (e.g. `tRec` without a KILL). Exception: a censored `tRec` (not recovered) ranks above every recovered seed, and a quantile that lands on one prints `censored`. Deltas and win/tie/loss use fair pairs only (same git, paramsHash and events); other pairs are listed as MISMATCH. `npwc` is priority-weighted by our own slot order: read it beside `coverage`, `sfMean` and `sfMax`.', '');
  for (const g of groupRecords(records)) out.push(...renderGroup(g));
  return out.join('\n');
}
