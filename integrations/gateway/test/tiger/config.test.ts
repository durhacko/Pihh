// TIG-03 (offline): the three credential loaders, the TLS rules (T35), credential separation (T31), the schema-name
// helper (T33) and the module's disabled state. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { FatalConfigError } from '../../src/errors.ts';
import { buildGateway } from '../../src/router.ts';
import {
  loadTigerAdminConfig, loadTigerImporterConfig, loadTigerReaderConfig, tlsModeLine, TigerConfigError, TIGER_BUDGETS, URL_TLS_PARAMS,
} from '../../src/tiger/config.ts';
import { createModule, moduleDisabled } from '../../src/tiger/module.ts';
import { checkSchemaName, schemaStatements, SchemaNameError } from '../../src/tiger/schemaName.ts';

const HOST = 'svc-abc123.tsdb.cloud.example';
const PASSWORD = 'pw-not-real-Zx9';
const URL_OK = `postgres://encore_api_app:${PASSWORD}@${HOST}:34567/tsdb`;

/** Runs `f`, expects a TigerConfigError with `reason`, and checks the message leaks nothing from the URL. */
function refused(f: () => unknown, reason: string): void {
  let error: unknown;
  try { f(); } catch (e) { error = e; }
  assert.ok(error instanceof TigerConfigError, `expected TigerConfigError ${reason}, got ${String(error)}`);
  assert.equal(error.reason, reason);
  for (const leak of [PASSWORD, HOST, 'postgres://', 'encore_api_app']) assert.ok(!error.message.includes(leak), `message leaks ${leak}`);
}

test('reader: not configured gives null (module disabled, others unaffected)', () => {
  assert.equal(loadTigerReaderConfig({}), null);
  assert.equal(loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: '  ' }), null);
});

test('reader: verify-full by default, budgets of RFC §13, and the URL never leaks through JSON, String or inspect', () => {
  const s = loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: URL_OK });
  assert.ok(s);
  assert.equal(s.sslMode, 'verify-full');
  assert.deepEqual(s.ssl, { rejectUnauthorized: true, servername: HOST });
  assert.equal(s.apiPoolMax, 3);
  assert.equal(s.statementTimeoutMs, 5_000);
  assert.equal(s.url.reveal(), URL_OK);
  for (const shown of [JSON.stringify(s), String(s.url), inspect(s, { depth: 5 })]) {
    assert.ok(!shown.includes(PASSWORD) && !shown.includes('postgres://'), shown);
  }
});

test('T31: the HTTP server refuses the importer, admin and live-write credentials, even when empty', () => {
  for (const name of ['TIGER_DATABASE_URL', 'TIGER_ADMIN_DATABASE_URL', 'TIGER_LIVE_WRITE_URL']) {
    refused(() => loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: URL_OK, [name]: URL_OK }), 'FORBIDDEN_CREDENTIAL');
    refused(() => loadTigerReaderConfig({ [name]: '' }), 'FORBIDDEN_CREDENTIAL');
  }
});

test('T31: the importer refuses the admin credential; needs its own; budgets of RFC §13', () => {
  refused(() => loadTigerImporterConfig({ TIGER_DATABASE_URL: URL_OK, TIGER_ADMIN_DATABASE_URL: URL_OK }), 'FORBIDDEN_CREDENTIAL');
  refused(() => loadTigerImporterConfig({}), 'MISSING_CREDENTIAL');
  const s = loadTigerImporterConfig({ TIGER_DATABASE_URL: URL_OK });
  assert.equal(s.importerConnections, 2);
  assert.equal(s.statementTimeoutMs, 30_000);
  assert.equal(TIGER_BUDGETS.apiPoolMax + TIGER_BUDGETS.importerConnections, 5);   // of max_connections = 25
});

test('admin: only TIGER_ADMIN_DATABASE_URL; refused when missing', () => {
  refused(() => loadTigerAdminConfig({}), 'MISSING_CREDENTIAL');
  const s = loadTigerAdminConfig({ TIGER_ADMIN_DATABASE_URL: URL_OK });
  assert.equal(s.sslMode, 'verify-full');
  assert.equal(s.statementTimeoutMs, 0);
});

test('T35: a URL carrying any TLS parameter is refused, whatever its value or letter case', () => {
  const values = ['require', 'no-verify', 'prefer', 'disable', 'verify-full', '1', 'true', ''];
  for (const param of URL_TLS_PARAMS) {
    for (const value of values) {
      for (const key of [param, param.toUpperCase()]) {
        const url = `${URL_OK}?application_name=x&${key}=${encodeURIComponent(value)}`;
        refused(() => loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: url }), 'URL_SETS_TLS');
        refused(() => loadTigerImporterConfig({ TIGER_DATABASE_URL: url }), 'URL_SETS_TLS');
        refused(() => loadTigerAdminConfig({ TIGER_ADMIN_DATABASE_URL: url }), 'URL_SETS_TLS');
      }
    }
  }
  assert.deepEqual([...URL_TLS_PARAMS], ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']);
});

test('T35: verify-full by default; require only with TIGER_TLS_UNVERIFIED=1; ssl built only from the mode (RFC §13 names)', () => {
  for (const env of [{}, { TIGER_TLS_UNVERIFIED: '' }, { TIGER_TLS_UNVERIFIED: '  ' }]) {
    const s = loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: URL_OK, ...env });
    assert.equal(s?.sslMode, 'verify-full');
    assert.deepEqual(s?.ssl, { rejectUnauthorized: true, servername: HOST });
  }
  const weak = loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: URL_OK, TIGER_TLS_UNVERIFIED: '1' });
  assert.equal(weak?.sslMode, 'require');
  assert.deepEqual(weak?.ssl, { rejectUnauthorized: false });
  // Anything but 1 or unset is refused, never guessed.
  for (const flag of ['0', 'true', 'TRUE', 'yes', 'on', '2', 'require', 'verify-full']) {
    refused(() => loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: URL_OK, TIGER_TLS_UNVERIFIED: flag }), 'INVALID_TLS_FLAG');
    refused(() => loadTigerImporterConfig({ TIGER_DATABASE_URL: URL_OK, TIGER_TLS_UNVERIFIED: flag }), 'INVALID_TLS_FLAG');
  }
  // There is no other TLS setting: a TIGER_SSL_MODE (not an RFC name) has no effect on the mode.
  assert.equal(loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: URL_OK, TIGER_SSL_MODE: 'disable' })?.sslMode, 'verify-full');
});

test('T35: the start-up line states the effective mode, warns for require, and names no host', () => {
  const full = tlsModeLine('api', { sslMode: 'verify-full' });
  const weak = tlsModeLine('api', { sslMode: 'require' });
  assert.match(full, /verify-full/);
  assert.match(weak, /WARNING TLS require/);
  for (const line of [full, weak]) assert.ok(!line.includes(HOST) && !line.includes('postgres://'));
});

test('bad URLs are refused without echoing them', () => {
  for (const url of ['not a url', `mysql://u:${PASSWORD}@${HOST}/db`, `http://${HOST}/`, 'postgres:///tsdb']) {
    refused(() => loadTigerReaderConfig({ TIGER_READ_DATABASE_URL: url }), 'INVALID_URL');
  }
});

test('T33: checkSchemaName accepts only ^(encore|tig_test_[0-9a-f]{12})$', () => {
  assert.equal(checkSchemaName('encore'), 'encore');
  assert.equal(checkSchemaName('tig_test_0123456789ab'), 'tig_test_0123456789ab');
  const hostile: unknown[] = [
    '', 'Encore', 'ENCORE', ' encore', 'encore ', 'encore\n', 'encore;', 'public', 'pg_catalog', '"encore"', 'encore.x',
    'encore; DROP SCHEMA encore CASCADE; --', "encore' OR '1'='1", 'tig_test_', 'tig_test_0123456789a', 'tig_test_0123456789abc',
    'tig_test_0123456789AB', 'tig_test_0123456789ag', 'TIG_TEST_0123456789ab', 'tig_test_0123456789ab\n', 'еncore' /* Cyrillic е */,
    'encore\u0000', '$1', null, undefined, 42, ['encore'], { toString: () => 'encore' },
  ];
  // One constant message for every rejected input, so no part of a hostile name is ever echoed.
  const messages = new Set<string>();
  for (const name of hostile) {
    assert.throws(() => checkSchemaName(name), SchemaNameError, JSON.stringify(String(name)));
    try { checkSchemaName(name); } catch (e) { messages.add((e as Error).message); }
  }
  assert.deepEqual([...messages], [new SchemaNameError().message]);
});

test('schemaStatements: format(%I) with the checked name as a bind parameter; never the name in the SQL text', () => {
  const { create, grants } = schemaStatements('tig_test_00000000000a');
  assert.equal(grants.length, 3);
  for (const call of [create, ...grants]) {
    assert.match(call.text, /^SELECT format\('[^']*%I[^']*', \$1::text\) AS sql$/);
    assert.ok(!call.text.includes('tig_test_'));
    assert.deepEqual(call.values, ['tig_test_00000000000a']);
  }
  assert.match(create.text, /CREATE SCHEMA IF NOT EXISTS %I/);
  assert.throws(() => schemaStatements('encore; DROP'), SchemaNameError);
});

test('module: disabled without TIGER_READ_DATABASE_URL, and in this offline build even with it; read routes registered (#262)', () => {
  for (const env of [{}, { TIGER_READ_DATABASE_URL: URL_OK }]) {
    const module = createModule(env);
    assert.equal(module.name, 'tiger');
    assert.deepEqual(module.health(), { enabled: false, db: 'disabled' });
    assert.deepEqual(module.routes.map(r => r.path), ['/api/runs', '/api/runs/:runId/metrics']);
    assert.ok(!JSON.stringify(module.health()).includes(PASSWORD));
  }
});

const FORBIDDEN_IN_SERVER = ['TIGER_DATABASE_URL', 'TIGER_ADMIN_DATABASE_URL', 'TIGER_LIVE_WRITE_URL'];

test('module: a credential the HTTP server must not hold is fatal (FatalConfigError); other bad settings are not', () => {
  for (const name of FORBIDDEN_IN_SERVER) {
    for (const env of [{ [name]: URL_OK }, { [name]: '' }, { TIGER_READ_DATABASE_URL: URL_OK, [name]: URL_OK }]) {
      assert.throws(() => createModule(env), FatalConfigError, name);
    }
  }
  // Not a forbidden credential: a plain TigerConfigError, so the registry contains it.
  for (const env of [{ TIGER_READ_DATABASE_URL: `${URL_OK}?sslmode=no-verify` }, { TIGER_READ_DATABASE_URL: URL_OK, TIGER_TLS_UNVERIFIED: 'yes' }, { TIGER_READ_DATABASE_URL: 'not a url' }]) {
    assert.throws(() => createModule(env), (e: unknown) => e instanceof TigerConfigError && !(e instanceof FatalConfigError));
  }
});

test('T31: the gateway refuses to start with a write, admin or live-write URL in its environment; nothing leaks', () => {
  for (const name of FORBIDDEN_IN_SERVER) {
    let error: unknown;
    try { buildGateway({ TIGER_READ_DATABASE_URL: URL_OK, [name]: URL_OK }); } catch (e) { error = e; }
    assert.ok(error instanceof FatalConfigError, `${name}: expected the build to refuse, got ${String(error)}`);
    assert.match(error.message, new RegExp(`^module tiger: the gateway HTTP server must not hold ${name}; .*refusing to start$`));
    for (const leak of [PASSWORD, HOST, 'postgres://', 'encore_api_app']) assert.ok(!error.message.includes(leak), `${name}: message leaks ${leak}`);
  }
});

test('gateway: a non-fatal tiger setting disables only tiger and is listed; other modules still run', () => {
  const gateway = buildGateway({ TIGER_READ_DATABASE_URL: `${URL_OK}?sslmode=no-verify` });
  const body = gateway.health();
  assert.deepEqual(body.modules.tiger, { enabled: false });
  assert.ok('gemini' in body.modules && 'shows' in body.modules);
  assert.ok(gateway.problems.some(p => p.includes('module tiger')));
  assert.ok(!gateway.problems.join('\n').includes(PASSWORD) && !JSON.stringify(body).includes(PASSWORD));
  // Without settings: { enabled: false, db: 'disabled' } (analytics RFC §3.1).
  assert.deepEqual(buildGateway({}).health().modules.tiger, { enabled: false, db: 'disabled' });
});

test('moduleDisabled: 503 DATABASE_UNAVAILABLE with reason MODULE_DISABLED and a valid requestId echoed', () => {
  const r = moduleDisabled('req-1');
  assert.equal(r.status, 503);
  assert.deepEqual(r.body.error.details, [{ path: '', reason: 'MODULE_DISABLED' }]);
  assert.equal(r.body.error.code, 'DATABASE_UNAVAILABLE');
  assert.equal(r.body.error.requestId, 'req-1');
  assert.equal(moduleDisabled('bad id with spaces').body.error.requestId, undefined);
});
