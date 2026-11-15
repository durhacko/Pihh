// src/telemetry/ledger.ts
// The local import ledger, `ledgerVersion` 1 (RFC §5, §10; TD-3): the state machine, line format, parsing and replay.
// Pure: appending a line (O_APPEND, fsync, lock file) is the gateway importer's job. The ledger is a journal, not an
// authority: Tiger says whether a run is present and verified, the local artifact says what it contains, and a lost
// ledger is rebuilt by reconciliation (§11). A corrupt line, such as a torn final write, is skipped with a warning.
import type { FileForm } from './validate';

export const LEDGER_VERSION = 1 as const;

export const LEDGER_STATES = ['discovered', 'validated', 'imported', 'verified', 'rejected', 'conflict', 'incomplete', 'archived'] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

/** Importer-local codes (RFC §10). Validation failures use the validator's issue codes. */
export const LEDGER_CODES = [
  'MANIFEST_MISMATCH', 'DT_UNVERIFIABLE', 'DT_ASSUMED', 'DEV_SEED', 'ARCHIVED', 'IDENTITY_MISMATCH', 'VERIFY_MISMATCH',
  'COMMIT_UNKNOWN', 'VALIDATOR_DB_DISAGREE',
] as const;

/**
 * The RFC §10 diagram, plus two readings of gaps in it:
 * - `discovered` starts every new attempt, from any state (§10: repeating the procedure is always safe; T12 records
 *   each attempt's file on its `discovered` line, including re-imports of a `verified` record);
 * - `validated → rejected` covers §11.2 case C′ (`VALIDATOR_DB_DISAGREE`) and §10 step 2(c) (`IDENTITY_MISMATCH`
 *   stops the attempt), which the diagram gives no edge.
 * Warnings that are not transitions (`DT_ASSUMED`) ride on the line of the transition they belong to, as its `code`.
 */
export const TRANSITIONS: Readonly<Record<LedgerState, readonly LedgerState[]>> = {
  discovered: ['validated', 'rejected'],
  validated: ['imported', 'validated', 'conflict', 'verified', 'archived', 'incomplete', 'rejected'],
  imported: ['verified', 'incomplete'],
  incomplete: ['verified', 'validated'],
  rejected: ['validated'],
  verified: ['incomplete', 'archived'],
  archived: ['verified'],
  conflict: [],
};

/** Terminal states of the diagram (`verified --> [*]`, `conflict --> [*]`). */
export const TERMINAL_STATES: readonly LedgerState[] = ['verified', 'conflict'];

export function isAllowedTransition(from: LedgerState | null, to: LedgerState): boolean {
  if (to === 'discovered') return true;
  return from !== null && TRANSITIONS[from].includes(to);
}

/** The file an attempt actually read, recorded on its `discovered` line (RFC §5). */
export interface ObservedFile { artifactPath: string; fileSha256: string; fileBytes: number; fileForm: FileForm }

export interface LedgerLine {
  ledgerVersion: typeof LEDGER_VERSION;
  /** Wall-clock instant, passed in by the importer (this module reads no clock). */
  at: string;
  attemptId: string;
  /** Null only before the artifact parsed (a `discovered` or `rejected` line of an unreadable file). */
  artifactHash: string | null;
  experimentKey: string | null;
  runId: string | null;
  from: LedgerState | null;
  to: LedgerState;
  code: string | null;
  /** A short, payload-free note (≤ 200 characters). */
  detail: string | null;
  file?: ObservedFile;
  /** Written by reconciliation when a lost ledger is rebuilt from Tiger (T14). */
  reconstructed?: true;
}

/** Tuning seeds that never appear in reported results (evaluation §5). */
export const DEV_SEEDS: readonly number[] = Object.freeze([101, 102, 103, 104, 105]);

/** RFC §10 step 1: an importer policy, not a validator rule. Schema `encore` refuses development seeds
 *  (`rejected`, `DEV_SEED`); test schemas (`tig_test_<12 hex>`) accept them. */
export function refusesDevSeed(seed: number, schema: string): boolean {
  return schema === 'encore' && DEV_SEEDS.includes(seed);
}

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const DETAIL_MAX = 200;
const LINE_KEYS = ['ledgerVersion', 'at', 'attemptId', 'artifactHash', 'experimentKey', 'runId', 'from', 'to', 'code', 'detail'];

function isState(value: unknown): value is LedgerState {
  return typeof value === 'string' && (LEDGER_STATES as readonly string[]).includes(value);
}
function nullOr(value: unknown, test: (v: string) => boolean): boolean {
  return value === null || (typeof value === 'string' && test(value));
}

/** Why `value` is not a valid ledger line, or null. */
export function ledgerLineProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not an object';
  const line = value as Record<string, unknown>;
  const keys = Object.keys(line);
  if (keys.some(k => !LINE_KEYS.includes(k) && k !== 'file' && k !== 'reconstructed') || LINE_KEYS.some(k => !Object.hasOwn(line, k))) return 'wrong keys';
  if (Object.hasOwn(line, 'reconstructed') && line.reconstructed !== true) return 'bad reconstructed';
  if (line.ledgerVersion !== LEDGER_VERSION) return 'unsupported ledgerVersion';
  if (typeof line.at !== 'string' || !INSTANT.test(line.at)) return 'bad at';
  if (typeof line.attemptId !== 'string' || !UUID.test(line.attemptId)) return 'bad attemptId';
  if (!nullOr(line.artifactHash, v => HEX64.test(v))) return 'bad artifactHash';
  if (!nullOr(line.experimentKey, v => HEX64.test(v))) return 'bad experimentKey';
  if (!nullOr(line.runId, v => UUID.test(v))) return 'bad runId';
  if (!(line.from === null || isState(line.from)) || !isState(line.to)) return 'bad state';
  if (!isAllowedTransition(line.from as LedgerState | null, line.to)) return 'transition not in the RFC §10 diagram';
  if (!nullOr(line.code, v => CODE.test(v))) return 'bad code';
  if (!nullOr(line.detail, v => v.length <= DETAIL_MAX && [...v].every(ch => ch.charCodeAt(0) >= 0x20))) return 'bad detail';
  if (line.artifactHash === null && !(line.to === 'discovered' || line.to === 'rejected')) return 'only discovered or rejected lines may lack artifactHash';
  if (Object.hasOwn(line, 'file')) {
    const file = line.file as Record<string, unknown> | null;
    if (line.to !== 'discovered') return 'only a discovered line records the file';
    if (typeof file !== 'object' || file === null || Object.keys(file).length !== 4) return 'bad file';
    if (typeof file.artifactPath !== 'string' || !PATH.test(file.artifactPath) || /(^|\/)\.\.(\/|$)/.test(file.artifactPath)) return 'bad file.artifactPath';
    if (typeof file.fileSha256 !== 'string' || !HEX64.test(file.fileSha256)) return 'bad file.fileSha256';
    if (!Number.isSafeInteger(file.fileBytes) || (file.fileBytes as number) <= 0) return 'bad file.fileBytes';
    if (file.fileForm !== 'cli-writer' && file.fileForm !== 'other') return 'bad file.fileForm';
  }
  return null;
}

/** One NDJSON line (with its trailing LF), keys in a fixed order. Throws on an invalid line, so nothing malformed is
 *  ever appended. */
export function formatLedgerLine(line: LedgerLine): string {
  const problem = ledgerLineProblem(line);
  if (problem) throw new Error(`formatLedgerLine: ${problem}`);
  const ordered: Record<string, unknown> = {};
  for (const key of LINE_KEYS) ordered[key] = line[key as keyof LedgerLine];
  if (line.file) ordered.file = { artifactPath: line.file.artifactPath, fileSha256: line.file.fileSha256, fileBytes: line.file.fileBytes, fileForm: line.file.fileForm };
  if (line.reconstructed) ordered.reconstructed = true;
  return `${JSON.stringify(ordered)}\n`;
}

/** The text to append for `line`. If the file's last byte is not LF (a torn final write), a LF goes first, so the
 *  torn tail can never swallow the new line. `lastByteIsLf` is true for an empty file. */
export function ledgerAppendText(lastByteIsLf: boolean, line: LedgerLine): string {
  return `${lastByteIsLf ? '' : '\n'}${formatLedgerLine(line)}`;
}

export interface LedgerWarning { lineNumber: number; reason: string }

const LINE_START = '{"ledgerVersion":';

/** Parses ledger text. Blank lines are ignored; a corrupt line is skipped and reported, never fatal. If a torn
 *  write was followed by a good line on the same physical line (an append without `ledgerAppendText`), the good
 *  line is recovered and the torn prefix reported. The marker cannot occur inside a string field, where
 *  JSON.stringify escapes the quotes. */
export function parseLedger(text: string): { lines: LedgerLine[]; skipped: LedgerWarning[] } {
  const lines: LedgerLine[] = [];
  const skipped: LedgerWarning[] = [];
  text.split('\n').forEach((raw, index) => {
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      const at = raw.lastIndexOf(LINE_START);
      let recovered: unknown = null;
      if (at > 0) {
        try { recovered = JSON.parse(raw.slice(at)); } catch { recovered = null; }
      }
      skipped.push({ lineNumber: index + 1, reason: 'not JSON (torn write?)' });
      if (recovered === null || ledgerLineProblem(recovered) !== null) return;
      value = recovered;
    }
    const problem = ledgerLineProblem(value);
    if (problem) skipped.push({ lineNumber: index + 1, reason: problem });
    else lines.push(value as LedgerLine);
  });
  return { lines, skipped };
}

/** Replays lines in order. A record's current state is its last line (keyed by `artifactHash`). Each line's `from`
 *  must be the previous line of the same attempt, or for an attempt's first hashed line the record's last state; a
 *  line that breaks this is kept but reported, because the ledger is a journal, not an authority. A `discovered`
 *  line (usually before the hash is known) starts an attempt. */
export function replayLedger(lines: readonly LedgerLine[]): { states: Map<string, LedgerLine>; anomalies: LedgerWarning[] } {
  const states = new Map<string, LedgerLine>();
  const lastInAttempt = new Map<string, LedgerState>();
  const anomalies: LedgerWarning[] = [];
  lines.forEach((line, index) => {
    if (line.to !== 'discovered') {
      const record = line.artifactHash === null ? undefined : states.get(line.artifactHash);
      const expected = lastInAttempt.get(line.attemptId) ?? record?.to ?? null;
      if (expected !== line.from) anomalies.push({ lineNumber: index + 1, reason: `from ${line.from ?? 'null'} does not follow ${expected ?? 'nothing'}` });
    }
    lastInAttempt.set(line.attemptId, line.to);
    if (line.artifactHash !== null) states.set(line.artifactHash, line);
  });
  return { states, anomalies };
}
