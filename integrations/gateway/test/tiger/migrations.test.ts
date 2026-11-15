// TIG-03 (offline): the migration files equal the ingestion RFC's DDL blocks, carry every delta TIG-03 lists, use
// unqualified names, and keep stable bytes. No database: the SQL is checked as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DT } from '../../../../src/contracts/index.ts';

const MIGRATIONS = new URL('../../src/tiger/migrations/', import.meta.url);
const RFC = readFileSync(new URL('../../../../docs/design/TIGER_TELEMETRY_AND_INGESTION_RFC.md', import.meta.url), 'utf8');
const FILES = [
  '000_migrations_table.sql', '001_runs.sql', '002_metrics.sql', '003_events.sql', '004_summaries.sql',
  '005_conflicts_verifications.sql', '006_roles.sql',
];
/** The RFC block for each file: the ```sql block whose "PROPOSED — NOT A MIGRATION" line names it. */
const RFC_MARKER: Record<string, string> = {
  '001_runs.sql': '(would be migration 001',
  '002_metrics.sql': '(would be migration 002',
  '003_events.sql': '(would be migration 003',
  '004_summaries.sql': '(would be migration 004',
  '005_conflicts_verifications.sql': '(would be migration 005',
  '006_roles.sql': '(006_roles.sql: grants only)',
};

const read = (name: string): string => readFileSync(new URL(name, MIGRATIONS), 'utf8');
/** The file below its header (everything after the first blank line). */
const bodyOf = (text: string): string => text.slice(text.indexOf('\n\n') + 2);
/** SQL with `--` comments removed (no string literal in these files contains `--`). */
const code = (text: string): string => text.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');

function rfcBlock(marker: string): string {
  const blocks = [...RFC.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1] ?? '');
  const found = blocks.filter(b => b.split('\n').some(l => l.startsWith('-- PROPOSED — NOT A MIGRATION') && l.includes(marker)));
  assert.equal(found.length, 1, `exactly one RFC block for ${marker}`);
  const lines = (found[0] as string).split('\n');
  const at = lines.findIndex(l => l.startsWith('-- PROPOSED — NOT A MIGRATION') && l.includes(marker));
  return lines.slice(at + 1).join('\n').replace(/\n+$/, '\n');
}

test('the migrations folder holds exactly 000-006, in order', () => {
  assert.deepEqual(readdirSync(MIGRATIONS).sort(), FILES);
});

test('001-006 below their header equal the RFC blocks byte for byte (RFC §6.1-§6.5, §13)', () => {
  for (const [file, marker] of Object.entries(RFC_MARKER)) assert.equal(bodyOf(read(file)), rfcBlock(marker), file);
});

test('stable bytes for the checksum: UTF-8 without BOM, LF only, a comment-only header, one trailing newline', () => {
  for (const file of FILES) {
    const bytes = readFileSync(new URL(file, MIGRATIONS));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${file}: BOM`);
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('\r'), `${file}: CR`);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${file}: trailing newline`);
    const header = text.slice(0, text.indexOf('\n\n')).split('\n');
    assert.ok(header.length > 0 && header.every(l => l.startsWith('-- ')), `${file}: header`);
  }
});

test('unqualified names: no schema in any file; the runner owns CREATE SCHEMA and search_path (RFC §7, TCR-40)', () => {
  for (const file of FILES) {
    const sql = code(read(file));
    assert.doesNotMatch(sql, /\bencore\s*\./i, file);
    assert.doesNotMatch(sql, /tig_test_/, file);
    assert.doesNotMatch(sql, /search_path/i, file);
    assert.doesNotMatch(sql, /\bCREATE\s+SCHEMA\b/i, file);
    assert.doesNotMatch(sql, /\bSET\s+/i, file);
  }
});

test('000: schema_migrations (version INT PK, name TEXT, sha256 TEXT, applied_at TIMESTAMPTZ) (RFC §7)', () => {
  const sql = code(read('000_migrations_table.sql'));
  assert.match(sql, /CREATE TABLE schema_migrations \(/);
  assert.match(sql, /\bversion\s+INTEGER PRIMARY KEY\b/);
  assert.match(sql, /\bname\s+TEXT NOT NULL\b/);
  assert.match(sql, /\bsha256\s+TEXT NOT NULL CHECK \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /\bapplied_at\s+TIMESTAMPTZ NOT NULL\b/);
});

test('TIG-03 deltas: experiment_key unique over clean runs (TCR-03, TCR-14)', () => {
  assert.match(code(read('001_runs.sql')), /CREATE UNIQUE INDEX experiment_runs_experiment_key_clean_uq\s+ON experiment_runs \(experiment_key\) WHERE git_clean;/);
});

test('TIG-03 deltas: tolerance CHECKs (TCR-12), not William\'s strict pwc range', () => {
  const sql = code(read('002_metrics.sql'));
  assert.ok(sql.includes('CHECK (pwc >= 0 AND pwc <= 1 + 1e-9)'));
  assert.doesNotMatch(sql, /pwc\s+BETWEEN\s+0\s+AND\s+1/);
});

test('TIG-03 deltas: immutable tick -> time CHECK through synthetic_time(tick) (TCR-23); DT * 1000 = 50 (TCR-15)', () => {
  assert.equal(DT * 1000, 50);
  const sql = code(read('002_metrics.sql'));
  assert.match(sql, /CREATE FUNCTION synthetic_time\(tick integer\) RETURNS timestamptz\s+LANGUAGE sql IMMUTABLE PARALLEL SAFE/);
  // The three-argument date_add (PG16+) is IMMUTABLE; `timestamptz + interval` is only STABLE.
  assert.ok(sql.includes(`date_add(timestamptz '2020-01-01 00:00:00+00', tick * interval '${DT * 1000} milliseconds', 'UTC')`));
  assert.ok(sql.includes('CHECK (sample_time = synthetic_time(tick))'));
  assert.ok(code(read('001_runs.sql')).includes(`CHECK (dt_seconds = ${DT})`));
});

test('TIG-03 deltas: PK contains sample_time; explicit, non-generated partition column; columnstore off; no legacy call', () => {
  const sql = code(read('002_metrics.sql'));
  assert.ok(sql.includes('PRIMARY KEY (run_id, sample_time)'));
  assert.ok(sql.includes("tsdb.partition_column = 'sample_time'"));
  assert.match(sql, /\bsample_time\s+TIMESTAMPTZ NOT NULL,/);
  assert.doesNotMatch(sql, /GENERATED/i);
  assert.ok(sql.includes('tsdb.columnstore      = false'));
  assert.doesNotMatch(sql, /create_hypertable\s*\(/i);
});

test('TIG-03 deltas: metrics_v with sim_seconds and synthetic_time (002); run_verifications in 005 (TCR-36)', () => {
  const metrics = code(read('002_metrics.sql'));
  assert.match(metrics, /CREATE VIEW metrics_v AS/);
  assert.match(metrics, /m\.tick \* r\.dt_seconds AS sim_seconds/);
  assert.match(metrics, /m\.sample_time AS synthetic_time/);
  const conflicts = code(read('005_conflicts_verifications.sql'));
  assert.match(conflicts, /CREATE TABLE import_conflicts \(/);
  assert.match(conflicts, /CREATE TABLE run_verifications \(/);
  assert.match(conflicts, /outcome\s+TEXT NOT NULL CHECK \(outcome IN \('verified', 'mismatch'\)\)/);
});

test('TIG-03 deltas: NO retention policy anywhere (William App. A)', () => {
  for (const file of FILES) {
    assert.doesNotMatch(code(read(file)), /retention/i, file);
    assert.doesNotMatch(code(read(file)), /add_\w*policy/i, file);
  }
});

test('006 holds grants only: no role creation, no password, and every granted table exists in 000-005', () => {
  const sql = code(read('006_roles.sql'));
  const statements = sql.split(';').map(s => s.trim()).filter(s => s !== '');
  assert.equal(statements.length, 2);
  for (const s of statements) assert.match(s, /^GRANT /);
  assert.doesNotMatch(sql, /CREATE\s+(ROLE|USER)|PASSWORD|ALTER\s+ROLE/i);
  const defined = new Set(FILES.slice(0, 6).flatMap(f => [...code(read(f)).matchAll(/CREATE (?:TABLE|VIEW) (\w+)/g)].map(m => m[1])));
  const granted = [...sql.matchAll(/ON ([\w\s,]+?)\s+TO /g)].flatMap(m => (m[1] ?? '').split(',').map(t => t.trim()));
  assert.ok(granted.length === 7, `granted: ${granted.join(', ')}`);
  for (const table of granted) assert.ok(defined.has(table), `${table} is created by 000-005`);
  // The reader gets nothing from the file: its three schema-level grants name the schema (schemaStatements).
  assert.doesNotMatch(sql, /encore_reader/);
});
