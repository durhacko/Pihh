// Offline guarantees for this skeleton (#218): no outbound network API, no third-party import, no environment access
// outside the entry point, no committed value, and nothing in the app or core imports the gateway (so it is never
// bundled). The one inbound server is `src/server.ts`, which may import only `createServer` (and types) from
// `node:http`. The live PRs relax these rules on purpose, in the one provider file each adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gateway = join(here, '..');
const repo = join(gateway, '..', '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, ext));
    else if (ext.test(name)) out.push(path);
  }
  return out;
}

const source = files(join(gateway, 'src'), /\.[cm]?[jt]sx?$/);
const rel = (file: string) => relative(gateway, file).replaceAll('\\', '/');
const raw = (file: string) => readFileSync(file, 'utf8');

/** Source without comments, so documentation may name what the code must not do. Used only for API names;
 *  imports and `process.` are scanned in the raw text, so a comment marker inside a string cannot hide them. */
function code(file: string): string {
  return raw(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Node built-ins each file may import, with the exact names. Everything else must be relative and inside src/. */
const BUILTINS: Record<string, Record<string, string[]>> = {
  'src/server.ts': {
    'node:http': ['createServer', 'type IncomingMessage', 'type Server', 'type ServerResponse'],
    'node:crypto': ['randomBytes'],
    'node:path': ['resolve'],
    'node:url': ['fileURLToPath'],
  },
  // contentHash and requestHash: sha256 over canonicalJson, server-side (mongodb spec §7.3, XI-7).
  'src/shows/validate.ts': { 'node:crypto': ['createHash'] },
};

/** XI-2 bridges: the one file per module that may import the app's pure src/ code, with the exact specifiers.
 *  Every other gateway file stays inside integrations/gateway/src/. Each module's own imports test checks the
 *  transitive graph of these targets. */
const BRIDGES: Record<string, string[]> = {
  'src/shows/validate.ts': [
    '../../../../src/app/compose/validate.ts',
    '../../../../src/score/canonical.ts',
    '../../../../src/contracts/params.ts',
  ],
};

test('the gateway source has the expected files', () => {
  const names = source.map(rel);
  for (const skeleton of ['server', 'guard', 'errors', 'config', 'health', 'module', 'modules', 'router']) {
    assert.ok(names.includes(`src/${skeleton}.ts`), `missing src/${skeleton}.ts`);
  }
});

test('imports: relative inside src/, or an allow-listed node built-in with exact names; no side-effect or dynamic import', () => {
  for (const file of source) {
    const text = raw(file);
    const name = rel(file);
    const statements = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm)];
    const anyFrom = [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)];
    assert.equal(statements.length, anyFrom.length, `${name}: an import is not at the start of a line`);
    for (const match of statements) {
      const specifier = match[1] ?? '';
      if (specifier.startsWith('node:')) {
        const allowed = BUILTINS[name]?.[specifier];
        assert.ok(allowed, `${name} imports ${specifier}`);
        const names = /\{([^}]*)\}/.exec(match[0])?.[1]?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
        assert.ok(/^\s*import\s*(?:type\s*)?\{/.test(match[0]), `${name}: ${specifier} must be a named import`);
        assert.deepEqual([...names].sort(), [...allowed].sort(), `${name}: ${specifier} names`);
        continue;
      }
      assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), `${name} imports ${specifier}`);
      const target = join(dirname(file), specifier);
      const leaves = relative(join(gateway, 'src'), target).split(/[\\/]/)[0] === '..';
      if (leaves) assert.ok(BRIDGES[name]?.includes(specifier), `${name} leaves src/: ${specifier}`);
    }
    assert.ok(!/^\s*import\s*['"]/m.test(text), `${name} has a side-effect import`);
    assert.ok(!/\bimport\s*\(/.test(text), `${name} uses a dynamic import`);
    assert.ok(!/\brequire\s*\(/.test(text), `${name} uses require(`);
  }
});

test('no outbound network API, eval or module loader in the code', () => {
  const forbidden = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /\beval\s*\(/,
    /\bnew\s+Function\b/, /getBuiltinModule/, /\bglobalThis\b/, /VITE_/, /\bcreateRequire\b/, /\bprocess\.binding\b/,
    /\b(?:request|get)\s*\(\s*['"`]https?:/];
  for (const file of source) {
    const text = code(file);
    for (const pattern of forbidden) assert.ok(!pattern.test(text), `${rel(file)} matches ${pattern}`);
  }
  // node:http is allowed only in server.ts, and only for createServer (checked above): no client API is reachable.
  for (const file of source) if (rel(file) !== 'src/server.ts') assert.ok(!raw(file).includes('node:http'), rel(file));
});

test('only the entry point touches process, and only env, argv, stderr, exitCode and signal handlers', () => {
  for (const file of source) {
    const uses = [...raw(file).matchAll(/\bprocess\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[)/g)].map(m => m[1] ?? '[');
    if (rel(file) !== 'src/server.ts') {
      assert.deepEqual(uses, [], `${rel(file)} touches process`);
      continue;
    }
    for (const use of uses) assert.ok(['env', 'argv', 'stderr', 'exitCode', 'on'].includes(use), `server.ts uses process.${use}`);
  }
});

test('the package has no dependencies', () => {
  const pkg = JSON.parse(raw(join(gateway, 'package.json'))) as Record<string, unknown>;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) assert.equal(pkg[field], undefined, field);
  const lock = JSON.parse(raw(join(gateway, 'package-lock.json'))) as { packages: Record<string, unknown> };
  assert.deepEqual(Object.keys(lock.packages), ['']);
});

test('every .env.example holds names only, never a value', () => {
  const examples = files(gateway, /^\.env\.example$/);
  assert.ok(examples.length >= 1);
  for (const file of examples) {
    for (const line of raw(file).split(/\r?\n/)) {
      const assignment = /^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
      if (assignment) assert.equal(assignment[2]?.trim(), '', `${rel(file)}: ${assignment[1]} has a value`);
    }
  }
});

test('no committed .env file', () => {
  const envFiles = files(gateway, /^\.env/).filter(file => basename(file) !== '.env.example');
  assert.deepEqual(envFiles.map(rel), []);
});

test('nothing in the app, core, CLI or root tests imports integrations/', () => {
  const app = [...files(join(repo, 'src'), /\.(ts|tsx|js|mjs)$/), ...files(join(repo, 'tests'), /\.(ts|tsx|js|mjs)$/)];
  assert.ok(app.length > 0);
  for (const file of app) assert.ok(!/['"][^'"]*integrations\//.test(raw(file)), relative(repo, file));
});

/** Environment variable names with `prefix` that a file's code mentions (comments stripped). */
function envNamesRead(text: string, prefix: string): Set<string> {
  // String.raw: in a plain template literal `\b` is a backspace, and the pattern would match nothing.
  const pattern = new RegExp(String.raw`\b(${prefix}[A-Z0-9_]+)\b`, 'g');
  return new Set([...text.matchAll(pattern)].map(m => m[1] ?? '').filter(name => name !== `${prefix}DEFAULTS`));
}

/** [file that reads the variables, its .env.example, prefix, must it read at least one?] */
const ENV_PAIRS: [string, string, string, boolean][] = [
  ['src/config.ts', '.env.example', 'GATEWAY_', true],
  ['src/gemini/config.ts', 'src/gemini/.env.example', 'GEMINI_', true],
  ['src/shows/module.ts', 'src/shows/.env.example', 'MONGODB_', false],
  ['src/tiger/module.ts', 'src/tiger/.env.example', 'TIGER_', false],
];

test('the env-name scan is not vacuous', () => {
  assert.deepEqual([...envNamesRead("read('GATEWAY_PORT') and GATEWAY_BIND, not XGATEWAY_NO or GATEWAY_DEFAULTS", 'GATEWAY_')], ['GATEWAY_PORT', 'GATEWAY_BIND']);
});

test('every variable the code reads is listed in the matching .env.example', () => {
  const listed = (file: string) => new Set([...raw(file).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
  for (const [source, example, prefix, required] of ENV_PAIRS) {
    const read = envNamesRead(code(join(gateway, source)), prefix);
    if (required) assert.ok(read.size > 0, `${source} reads no ${prefix}* variable`);
    if (read.size === 0) continue;
    const names = listed(join(gateway, example));
    for (const name of read) assert.ok(names.has(name), `${name} (read in ${source}) is missing from ${example}`);
  }
});
