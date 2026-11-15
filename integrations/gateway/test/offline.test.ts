// Offline guarantees for this skeleton (#218): no network API, no third-party import and no environment access in
// the gateway source, no committed key, and nothing in the app or core imports the gateway (so it is never bundled).
// The live PR relaxes the first rule on purpose, in the one provider file it adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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

const source = files(join(gateway, 'src'), /\.ts$/);

/** Source without comments, so documentation may name what the code must not do. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

test('the gateway source makes no network call and reads no environment directly', () => {
  assert.ok(source.length >= 6);
  const forbidden = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /node:(https?|http2|net|tls|dgram|dns|child_process|worker_threads)\b/, /\bprocess\.env\b/, /VITE_/, /\beval\s*\(/, /\bnew Function\b/];
  for (const file of source) {
    const text = code(file);
    for (const pattern of forbidden) assert.ok(!pattern.test(text), `${relative(gateway, file)} matches ${pattern}`);
  }
});

test('the gateway source imports only its own files (no SDK, no packages, no src/ yet)', () => {
  for (const file of source) {
    const text = code(file);
    for (const match of text.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1] ?? '';
      assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), `${relative(gateway, file)} imports ${specifier}`);
      const target = join(dirname(file), specifier);
      assert.ok(relative(join(gateway, 'src'), target).split(/[\\/]/)[0] !== '..', `${relative(gateway, file)} leaves src/: ${specifier}`);
    }
    assert.ok(!/\bimport\s*\(/.test(text), `${relative(gateway, file)} uses a dynamic import`);
  }
});

test('the package has no dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(gateway, 'package.json'), 'utf8')) as Record<string, unknown>;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(pkg[field], undefined, field);
  const lock = JSON.parse(readFileSync(join(gateway, 'package-lock.json'), 'utf8')) as { packages: Record<string, unknown> };
  assert.deepEqual(Object.keys(lock.packages), ['']);
});

test('.env.example holds no key value', () => {
  const lines = readFileSync(join(gateway, '.env.example'), 'utf8').split('\n');
  const key = lines.find(line => line.startsWith('GEMINI_API_KEY='));
  assert.equal(key, 'GEMINI_API_KEY=');
});

test('nothing in the app, core, CLI or root tests imports integrations/', () => {
  const app = [...files(join(repo, 'src'), /\.(ts|tsx|js|mjs)$/), ...files(join(repo, 'tests'), /\.(ts|tsx|js|mjs)$/)];
  assert.ok(app.length > 0);
  for (const file of app) assert.ok(!/['"][^'"]*integrations\//.test(readFileSync(file, 'utf8')), relative(repo, file));
});
