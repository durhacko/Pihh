// TIG-03 (offline): the migration files equal the ingestion RFC's DDL blocks, carry every delta TIG-03 lists, use
// unqualified names, and keep stable bytes. No database: the SQL is checked as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DT } from '../../../../src/contracts/index.ts';
import { schemaStatements } from '../../src/tiger/schemaName.ts';

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

// ---------- #245 review follow-ups (test-only) ----------

/** The format() template inside a schemaStatements call: `SELECT format('<template>', $1::text) AS sql`. */
function templateOf(text: string): string {
  const m = /^SELECT format\('([^']*)', \$1::text\) AS sql$/.exec(text);
  assert.ok(m, `not a format(%I) call: ${text}`);
  return m[1] as string;
}

test('#245 follow-up (1): the three schema-level grant templates are the RFC §13 lines, with <schema> as %I', () => {
  // The three commented lines of the §13 006 block ("These three name the schema ..."), verbatim apart from
  // the leading "--   ", the trailing ";" and the trailing comment.
  const rfc = rfcBlock('(006_roles.sql: grants only)').split('\n')
    .filter(l => /^--\s+(GRANT|ALTER DEFAULT PRIVILEGES)\b/.test(l))
    .map(l => l.replace(/^--\s+/, '').replace(/;.*$/, '').replace('<schema>', '%I'));
  assert.equal(rfc.length, 3, 'the RFC lists three schema-level statements');
  assert.deepEqual(schemaStatements('encore').grants.map(c => templateOf(c.text)), rfc);
  assert.equal(templateOf(schemaStatements('encore').create.text), 'CREATE SCHEMA IF NOT EXISTS %I');   // RFC §7 runner row
});

/**
 * Every `qualifier.name` in SQL text, outside comments, string literals, quoted identifiers and numbers, whose
 * qualifier is not allowed. Allowed: the TimescaleDB `tsdb.*` table options; column references `table.column` whose
 * table is one of `tables` (those 000-005 create); and table aliases the same text declares (`FROM t m`, `JOIN t r`).
 * Anything else (`encore.x`, `public.x`, `pg_catalog.x`, `tig_test_….x`) is a schema.
 */
function schemaQualified(sqlText: string, tables: ReadonlySet<string> = new Set()): string[] {
  const stripped = code(sqlText)
    .replace(/\$\$[\s\S]*?\$\$/g, m => m.replace(/'[^']*'/g, "''"))   // literals inside dollar-quoted bodies
    .replace(/'(?:[^']|'')*'/g, "''")                                  // string literals
    .replace(/"(?:[^"]|"")*"/g, '""');                                  // quoted identifiers (asserted absent below)
  const aliases = new Set([...stripped.matchAll(/\b(?:FROM|JOIN)\s+\w+\s+(?:AS\s+)?(\w+)/gi)].map(m => (m[1] ?? '').toLowerCase()));
  for (const keyword of ['on', 'using', 'where', 'join', 'group', 'order', 'left', 'inner', 'with']) aliases.delete(keyword);
  const bad: string[] = [];
  for (const m of stripped.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/g)) {
    const qualifier = (m[1] ?? '').toLowerCase();
    if (qualifier === 'tsdb' || aliases.has(qualifier) || tables.has(qualifier)) continue;
    bad.push(m[0]);
  }
  return bad;
}

test('#245 follow-up (2): the schema-qualification guard itself: catches schemas, allows tsdb.* and aliases', () => {
  assert.deepEqual(schemaQualified('CREATE TABLE encore.experiment_runs (x int);'), ['encore.experiment_runs']);
  assert.deepEqual(schemaQualified('SELECT 1 FROM public . t;'), ['public . t']);
  assert.deepEqual(schemaQualified('GRANT SELECT ON pg_catalog.pg_roles TO r;'), ['pg_catalog.pg_roles']);
  assert.deepEqual(schemaQualified('INSERT INTO tig_test_0123456789ab.simulation_metrics VALUES (1);'), ['tig_test_0123456789ab.simulation_metrics']);
  assert.deepEqual(schemaQualified(") WITH (tsdb.hypertable, tsdb.partition_column = 'sample_time');"), []);
  assert.deepEqual(schemaQualified('SELECT m.run_id, r.dt_seconds FROM simulation_metrics m JOIN experiment_runs r USING (run_id);'), []);
  assert.deepEqual(schemaQualified("CHECK (a = 'encore.x') -- encore.y in a comment\n"), []);
  assert.deepEqual(schemaQualified('CHECK (pwc <= 1 + 1e-9 AND x >= 0.05)'), []);
  // An alias declared for a different table name does not excuse an undeclared qualifier.
  assert.deepEqual(schemaQualified('SELECT m.a, encore.b FROM t m;'), ['encore.b']);
  // A column reference is allowed only through a table the migrations create, never through a schema name.
  const tables = new Set(['simulation_metrics']);
  assert.deepEqual(schemaQualified('COMMENT ON COLUMN simulation_metrics.sample_time IS $x$;', tables), []);
  assert.deepEqual(schemaQualified('COMMENT ON COLUMN encore.simulation_metrics.sample_time IS $x$;', tables), ['encore.simulation_metrics']);
  assert.deepEqual(schemaQualified('COMMENT ON COLUMN other_table.x IS $x$;', tables), ['other_table.x']);
});

/** Tables and views created by 000-005, the only valid qualifiers of a column reference. */
const CREATED = new Set(FILES.slice(0, 6).flatMap(f => [...code(read(f)).matchAll(/CREATE (?:TABLE|VIEW) (\w+)/g)].map(m => (m[1] ?? '').toLowerCase())));

test('#245 follow-up (2): no migration file qualifies any name with a schema, and none uses a quoted identifier', () => {
  assert.deepEqual([...CREATED].sort(), [
    'experiment_runs', 'import_conflicts', 'metrics_v', 'run_summaries', 'run_verifications', 'schema_migrations',
    'simulation_events', 'simulation_metrics',
  ]);
  for (const file of FILES) {
    const text = read(file);
    assert.deepEqual(schemaQualified(text, CREATED), [], file);
    assert.doesNotMatch(code(text).replace(/'(?:[^']|'')*'/g, "''"), /"/, `${file}: quoted identifier`);
  }
  // The runner's statements carry the schema only as a %I bind parameter, never as a qualifier.
  const { create, grants } = schemaStatements('encore');
  for (const call of [create, ...grants]) assert.deepEqual(schemaQualified(templateOf(call.text)), [], call.text);
});

/** The privileges of every GRANT statement in `sqlText` (the list between GRANT and ON), upper-cased. */
function grantedPrivileges(sqlText: string): string[] {
  return [...code(sqlText).matchAll(/\bGRANT\s+([\s\S]+?)\s+ON\b/gi)]
    .flatMap(m => (m[1] ?? '').split(',').map(p => p.trim().toUpperCase().replace(/\s+/g, ' ')));
}

test('#245 follow-up (3): 006 and the schema-level grants never grant UPDATE, DELETE, TRUNCATE or ALL', () => {
  const file = grantedPrivileges(read('006_roles.sql'));
  const schema = schemaStatements('encore').grants.flatMap(c => grantedPrivileges(templateOf(c.text)));
  assert.deepEqual(file, ['SELECT', 'INSERT', 'SELECT']);
  assert.deepEqual(schema, ['USAGE', 'SELECT', 'SELECT']);
  for (const p of [...file, ...schema]) {
    assert.ok(['SELECT', 'INSERT', 'USAGE'].includes(p), `unexpected privilege ${p}`);
    assert.doesNotMatch(p, /\b(UPDATE|DELETE|TRUNCATE|ALL|REFERENCES|TRIGGER|CREATE|TEMP|TEMPORARY|MAINTAIN)\b/);
  }
  // "ALL TABLES IN SCHEMA" is an object scope, not ALL PRIVILEGES; no GRANT ... ALL [PRIVILEGES] anywhere.
  for (const sql of [read('006_roles.sql'), ...schemaStatements('encore').grants.map(c => templateOf(c.text))]) {
    assert.doesNotMatch(code(sql), /\bGRANT\s+ALL\b/i);
    assert.doesNotMatch(code(sql), /\bWITH\s+GRANT\s+OPTION\b/i);
  }
  // The guard helper itself sees what it must refuse.
  assert.deepEqual(grantedPrivileges('GRANT SELECT, UPDATE ON t TO r; GRANT ALL PRIVILEGES ON u TO r;'), ['SELECT', 'UPDATE', 'ALL PRIVILEGES']);
});
