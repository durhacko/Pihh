// TIG-02 ledger (RFC §5, §10): the offline halves of TIG-T11, T14 and T15, and the DEV_SEED policy of T12.
// Scripted attempt sequences only; appending to disk, reconciliation and the repository are the gateway's (TIG-04/05).
import { describe, expect, it } from 'vitest';
import {
  formatLedgerLine, isAllowedTransition, LEDGER_STATES, ledgerAppendText, ledgerLineProblem, parseLedger, refusesDevSeed, replayLedger,
  TRANSITIONS, type LedgerLine, type LedgerState,
} from '../../src/telemetry';

const HASH = 'a57f6103f79b604512c090862f7573be22c9545469d816ee04880ee2cfd12978';   // results/S0_n200_encore_s1.json (0b2f8f3)
const KEY = '8cd5bd9e811bba00526905d8e25c8b7bcafdaa930c27f1a4cfd8d7797d5acc60';
const RUN = '6f0f3c1e-0b1a-5c3d-8e2f-1a2b3c4d5e6f';
const attempt = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FILE = { artifactPath: 'results/S0_n200_encore_s1.json', fileSha256: '52daabead13e76cc7ca9646a3cd36f7b908e28348d3dc9770f30d2a4b736b56c', fileBytes: 109_386, fileForm: 'cli-writer' as const };

function line(attemptN: number, from: LedgerState | null, to: LedgerState, extra: Partial<LedgerLine> = {}): LedgerLine {
  const hashed = to !== 'discovered';
  return {
    ledgerVersion: 1, at: '2026-11-15T03:00:00.000Z', attemptId: attempt(attemptN),
    artifactHash: hashed ? HASH : null, experimentKey: hashed ? KEY : null, runId: hashed ? RUN : null,
    from, to, code: null, detail: null, ...(to === 'discovered' ? { file: FILE } : {}), ...extra,
  };
}
/** One attempt: discovered, then each state in turn, each `from` the previous. */
function attemptLines(n: number, startFrom: LedgerState | null, ...states: LedgerState[]): LedgerLine[] {
  const out = [line(n, startFrom, 'discovered')];
  let from: LedgerState = 'discovered';
  for (const to of states) { out.push(line(n, from, to)); from = to; }
  return out;
}

describe('the RFC §10 state machine', () => {
  it('has exactly the RFC states and diagram edges (plus the two documented readings)', () => {
    expect([...LEDGER_STATES].sort()).toEqual(['archived', 'conflict', 'discovered', 'imported', 'incomplete', 'rejected', 'validated', 'verified']);
    const edges = Object.entries(TRANSITIONS).flatMap(([from, tos]) => tos.map(to => `${from}>${to}`)).sort();
    expect(edges).toEqual([
      'archived>verified', 'discovered>rejected', 'discovered>validated', 'imported>incomplete', 'imported>verified',
      'incomplete>validated', 'incomplete>verified', 'rejected>validated', 'validated>archived', 'validated>conflict',
      'validated>imported', 'validated>incomplete', 'validated>rejected', 'validated>validated', 'validated>verified',
      'verified>archived', 'verified>incomplete',
    ]);
    expect(isAllowedTransition(null, 'discovered')).toBe(true);
    expect(isAllowedTransition('verified', 'discovered')).toBe(true);   // a new attempt
    expect(isAllowedTransition(null, 'validated')).toBe(false);
    expect(isAllowedTransition('conflict', 'verified')).toBe(false);
    expect(isAllowedTransition('imported', 'archived')).toBe(false);
  });

  it('T11 (offline): retryable rollback, lost COMMIT, and reconciliation are all legal sequences', () => {
    const lines = [
      ...attemptLines(1, null, 'validated', 'validated'),                                  // fault after row 200: rolled back, stays validated
      line(1, 'validated', 'incomplete', { code: 'COMMIT_UNKNOWN' }),                      // lost acknowledgement
      line(2, 'incomplete', 'discovered'), line(2, 'discovered', 'validated'), line(2, 'validated', 'validated'),
    ];
    const { states, anomalies } = replayLedger(parseLedger(lines.map(formatLedgerLine).join('')).lines);
    expect(anomalies).toEqual([]);
    expect(states.get(HASH)?.to).toBe('validated');
    expect(ledgerLineProblem(line(3, 'incomplete', 'verified'))).toBeNull();               // reconciliation finds rows
  });

  it('T15 (offline): archived with ARCHIVED on re-import, and restore back to verified', () => {
    const lines = [
      ...attemptLines(1, null, 'validated', 'imported', 'verified'),
      line(1, 'verified', 'archived'),                                                     // owner runs Q16
      ...attemptLines(2, 'archived', 'validated'),
      line(2, 'validated', 'archived', { code: 'ARCHIVED' }),                              // importer: never VERIFY_MISMATCH
      line(3, 'archived', 'verified'),                                                     // owner restore Q16b
    ];
    const { states, anomalies } = replayLedger(lines);
    expect(anomalies).toEqual([]);
    expect(states.get(HASH)?.to).toBe('verified');
  });
});

describe('T14 (offline): append-only journal', () => {
  it('appending keeps every earlier line byte-identical, and the current state is the last line per artifactHash', () => {
    const first = attemptLines(1, null, 'validated', 'imported', 'verified').map(formatLedgerLine).join('');
    const appended = first + attemptLines(2, 'verified', 'validated', 'verified').map(formatLedgerLine).join('');
    expect(appended.startsWith(first)).toBe(true);
    const parsed = parseLedger(appended);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.lines).toHaveLength(7);
    expect(replayLedger(parsed.lines).states.get(HASH)).toMatchObject({ attemptId: attempt(2), to: 'verified' });
    // each attempt records the file it actually read on its discovered line (RFC §5)
    expect(parsed.lines.filter(l => l.to === 'discovered').map(l => l.file)).toEqual([FILE, FILE]);
  });

  it('skips a torn final write and a corrupt line with a warning, never fatally', () => {
    const good = attemptLines(1, null, 'validated').map(formatLedgerLine).join('');
    const torn = formatLedgerLine(line(1, 'validated', 'imported')).slice(0, 40);
    const { lines, skipped } = parseLedger(`${good}{"ledgerVersion":1,"bogus":true}\n\n${torn}`);
    expect(lines).toHaveLength(2);
    expect(skipped.map(s => s.lineNumber)).toEqual([3, 5]);
  });

  it('reports, but keeps, a line whose from does not follow the record', () => {
    const lines = [...attemptLines(1, null, 'validated'), line(1, 'imported', 'verified')];
    const { states, anomalies } = replayLedger(lines);
    expect(anomalies).toHaveLength(1);
    expect(states.get(HASH)?.to).toBe('verified');
  });

  it('refuses to format or parse a line outside the diagram or with bad fields', () => {
    expect(() => formatLedgerLine(line(1, 'conflict', 'verified'))).toThrow();
    expect(() => formatLedgerLine(line(1, null, 'validated'))).toThrow();
    expect(() => formatLedgerLine({ ...line(1, 'discovered', 'validated'), at: 'now' })).toThrow();
    expect(() => formatLedgerLine({ ...line(1, 'discovered', 'validated'), code: 'lower' })).toThrow();
    expect(() => formatLedgerLine({ ...line(1, 'discovered', 'validated'), detail: 'x'.repeat(201) })).toThrow();
    expect(() => formatLedgerLine({ ...line(1, 'discovered', 'validated'), artifactHash: null })).toThrow();
    expect(() => formatLedgerLine({ ...line(1, null, 'discovered'), file: { ...FILE, artifactPath: '../x' } })).toThrow();
    expect(() => formatLedgerLine({ ...line(1, 'discovered', 'validated'), file: FILE })).toThrow();
    expect(ledgerLineProblem({ ...line(1, 'discovered', 'validated'), extra: 1 })).toBe('wrong keys');
  });

  it('refuses a zero fileBytes, control characters in detail and reconstructed: false', () => {
    expect(ledgerLineProblem({ ...line(1, null, 'discovered'), file: { ...FILE, fileBytes: 0 } })).not.toBeNull();
    expect(ledgerLineProblem({ ...line(1, 'discovered', 'validated'), detail: 'a\nb' })).toBe('bad detail');
    expect(ledgerLineProblem({ ...line(1, 'discovered', 'validated'), reconstructed: false as never })).toBe('bad reconstructed');
  });

  it('never lets a torn final write swallow the next line', () => {
    const good = attemptLines(1, null, 'validated').map(formatLedgerLine).join('');
    const torn = formatLedgerLine(line(1, 'validated', 'imported')).slice(0, 40);   // no LF: the write died
    const next = attemptLines(2, 'validated', 'validated');
    // the appender adds a LF first when the file does not end in one
    const appended = good + torn + next.map((l, i) => ledgerAppendText(i > 0 || false, l)).join('');
    const parsed = parseLedger(appended);
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.lines[2]?.file).toEqual(FILE);
    expect(ledgerAppendText(true, next[0]!)).toBe(formatLedgerLine(next[0]!));
    // and an append without the helper is still recovered by the parser, with the torn prefix reported
    const raw = parseLedger(good + torn + next.map(formatLedgerLine).join(''));
    expect(raw.lines).toHaveLength(4);
    expect(raw.lines[2]?.file).toEqual(FILE);
    expect(raw.skipped).toHaveLength(1);
    expect(replayLedger(raw.lines).anomalies).toEqual([]);
  });

  it('marks reconstructed lines (a lost ledger rebuilt from Tiger)', () => {
    const text = formatLedgerLine({ ...line(9, 'validated', 'verified'), reconstructed: true });
    expect(JSON.parse(text).reconstructed).toBe(true);
    expect(parseLedger(text).lines[0]?.reconstructed).toBe(true);
  });

  it('writes a rejected line with no hash for an unreadable file', () => {
    const lines = [line(1, null, 'discovered'), { ...line(1, 'discovered', 'rejected', { code: 'NOT_JSON' }), artifactHash: null, experimentKey: null, runId: null }];
    expect(lines.map(l => ledgerLineProblem(l))).toEqual([null, null]);
  });
});

describe('T12 (offline): development seeds', () => {
  it('refuses seeds 101–105 in schema encore only', () => {
    expect([100, 101, 105, 106].map(seed => refusesDevSeed(seed, 'encore'))).toEqual([false, true, true, false]);
    expect(refusesDevSeed(101, 'tig_test_0123456789ab')).toBe(false);
  });
});
