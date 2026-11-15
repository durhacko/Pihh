// src/cli/repro.ts — the `p2-repro/1` file of the fault-schedule fuzzer (P2-WP-02; PHASE2_EVALUATION §6.2): a
// self-contained, versioned record of one shrunk failing run, enough to replay it exactly. It is its own format, not a
// RunRecord. Serialised with canonicalJson plus a newline, so equal inputs give byte-identical files (P2-T03); it has
// no wall-clock field.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EnvEvent, Params, Score } from '../contracts';
import type { InvariantId, InvariantThresholds } from '../observer/invariants';
import { INVARIANT_IDS } from '../observer/invariants';
import { canonicalJson } from '../score/canonical';
import type { Arm } from './brains';

export const REPRO_VERSION = 'p2-repro/1';

export interface ReproViolation {
  inv: InvariantId;
  firstTick: number;
  ids: number[];
  slot?: number;
  /** The checker's knownLimit tag (null: a counterexample). An addition to §6.2's field list, so a tagged find is never read as one. */
  knownLimit: string | null;
  detail: string;
}

export interface ReproShrink { fromUnits: number; toUnits: number; tests: number; oneMinimal: boolean }

export interface Repro {
  v: typeof REPRO_VERSION;
  git: string;
  campaign: string;
  campaignSeed: number;
  run: number;
  arm: Arm;
  seed: number;
  n0: number;
  ticks: number;
  params: Params;
  paramsHash: string;
  score: Score;
  events: EnvEvent[];
  thresholds: InvariantThresholds;
  violation: ReproViolation;
  shrink: ReproShrink;
  stateHash: string;
}

/** The file text: canonicalJson plus a newline. */
export function serialiseRepro(repro: Repro): string {
  return `${canonicalJson(repro)}\n`;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Parses and checks a repro file. Throws an Error naming the first bad field. */
export function parseRepro(text: string): Repro {
  let value: unknown;
  try { value = JSON.parse(text); } catch (e) { throw new Error(`repro: not JSON (${e instanceof Error ? e.message : String(e)})`); }
  if (!isObj(value)) throw new Error('repro: not an object');
  const r = value;
  const need = (ok: boolean, field: string) => { if (!ok) throw new Error(`repro: bad or missing field ${field}`); };
  need(r.v === REPRO_VERSION, 'v');
  need(typeof r.git === 'string', 'git');
  need(typeof r.campaign === 'string', 'campaign');
  need(isInt(r.campaignSeed) && (r.campaignSeed as number) >= 0, 'campaignSeed');
  need(isInt(r.run) && (r.run as number) >= 0, 'run');
  need(r.arm === 'encore' || r.arm === 'static', 'arm');
  need(isInt(r.seed) && (r.seed as number) >= 0, 'seed');
  need(isInt(r.n0) && (r.n0 as number) >= 1, 'n0');
  need(isInt(r.ticks) && (r.ticks as number) >= 0, 'ticks');
  need(isObj(r.params) && (r.params as Record<string, unknown>).n0 === r.n0, 'params');
  need(typeof r.paramsHash === 'string' && /^[0-9a-f]{64}$/.test(r.paramsHash), 'paramsHash');
  need(isObj(r.score) && Array.isArray((r.score as Record<string, unknown>).movements), 'score');
  need(Array.isArray(r.events) && (r.events as unknown[]).every(e => isObj(e) && typeof e.type === 'string' && isInt(e.tick)), 'events');
  need(isObj(r.thresholds) && ['Ddup', 'Q', 'C', 'W'].every(k => isInt((r.thresholds as Record<string, unknown>)[k])), 'thresholds');
  const v = r.violation;
  need(isObj(v) && (INVARIANT_IDS as readonly unknown[]).includes(v.inv) && isInt(v.firstTick) && Array.isArray(v.ids)
    && (v.knownLimit === null || typeof v.knownLimit === 'string') && typeof v.detail === 'string', 'violation');
  const s = r.shrink;
  need(isObj(s) && isInt(s.fromUnits) && isInt(s.toUnits) && isInt(s.tests) && typeof s.oneMinimal === 'boolean', 'shrink');
  need(typeof r.stateHash === 'string', 'stateHash');
  return value as unknown as Repro;
}

/** The file name a repro is written under: campaign, seed, run and INV, so names are stable and distinct. */
export function reproFileName(repro: Pick<Repro, 'campaign' | 'campaignSeed' | 'run' | 'violation'>): string {
  return `${repro.campaign.toLowerCase()}-s${repro.campaignSeed}-r${repro.run}-${repro.violation.inv.toLowerCase()}.json`;
}

/** Writes the repro into `dir` (created if missing) and returns the path. Nothing is written outside `dir`. */
export function writeRepro(dir: string, repro: Repro): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, reproFileName(repro));
  writeFileSync(path, serialiseRepro(repro));
  return path;
}

export function readRepro(path: string): Repro {
  return parseRepro(readFileSync(path, 'utf8'));
}
