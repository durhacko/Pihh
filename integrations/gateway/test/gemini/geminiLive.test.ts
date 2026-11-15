// scripts/gemini-live.sh reads the key file as DATA (#218 follow-up): only the GEMINI_API_KEY= line, never sourced, so
// nothing else in the file runs or is exported; it refuses a symlink, a file that is not owner-only, a missing line and
// a value that is not key-shaped, and never prints the value. Run with GEMINI_LIVE_CHECK_ONLY=1, so it never starts the
// gateway; all keys here are fake. As a second line of defence, should that switch ever regress, the script runs with
// a timeout, the tripwire in NODE_OPTIONS and port 0, so it could neither reach Google nor take a real port.
import '../no-network.mjs'; // the network tripwire, FIRST (it also puts itself in NODE_OPTIONS for the script's node)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/gemini-live.sh', import.meta.url));
const FAKE = 'AIzaFAKE-not-a-real-key_0123456789abcdef';

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-live-'));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

assert.equal(fetch.name, 'guardedFetch', 'the network tripwire (test/no-network.mjs) is not in force');

function check(file: string) {
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', GEMINI_ENV_FILE: file, GEMINI_LIVE_CHECK_ONLY: '1',
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? '', GATEWAY_PORT: '0',
  };
  // Run directly, as its usage line and the README say: it must be executable (tracked as 100755).
  const result = spawnSync(SCRIPT, [], { encoding: 'utf8', env, timeout: 15_000 });
  assert.equal(result.signal, null, 'the script finished by itself (it never started the gateway)');
  const output = `${result.stdout}${result.stderr}`;
  return { status: result.status, output };
}

function keyFile(dir: string, text: string, mode = 0o600): string {
  const file = join(dir, 'gemini.env');
  writeFileSync(file, text);
  chmodSync(file, mode);
  return file;
}

test('gemini-live.sh: only the key line is read; a command in the file never runs; the key is never printed', () => {
  withDir(dir => {
    const pwned = join(dir, 'pwned');
    const file = keyFile(dir, `# comment\nGEMINI_ENABLED=0\nEVIL=$(touch ${pwned})\n\`touch ${pwned}\`\nGEMINI_API_KEY=${FAKE}\r\nGEMINI_API_KEY=second-line-is-ignored-xxxxxxxx\n`);
    const { status, output } = check(file);
    assert.equal(status, 0, output);
    assert.match(output, /key file ok/);
    assert.ok(!output.includes(FAKE), 'the key is never printed');
    assert.ok(!existsSync(pwned), 'the file was sourced: a command in it ran');
  });
});

test('gemini-live.sh: quoted values are accepted; shell syntax in the value is refused without running or printing it', () => {
  withDir(dir => {
    assert.equal(check(keyFile(dir, `GEMINI_API_KEY="${FAKE}"\n`)).status, 0);
    assert.equal(check(keyFile(dir, `export GEMINI_API_KEY='${FAKE}'\n`)).status, 0);
    const pwned = join(dir, 'pwned');
    const bad = `${FAKE}$(touch ${pwned})`;
    const { status, output } = check(keyFile(dir, `GEMINI_API_KEY=${bad}\n`));
    assert.equal(status, 1);
    assert.match(output, /not key-shaped \(not shown\)/);
    assert.ok(!output.includes(FAKE) && !existsSync(pwned));
  });
});

test('gemini-live.sh: refuses a missing file, a symlink, a group- or world-readable file and a file without the key line', () => {
  withDir(dir => {
    assert.match(check(join(dir, 'absent.env')).output, /no key file/);
    const real = keyFile(dir, `GEMINI_API_KEY=${FAKE}\n`);
    const link = join(dir, 'link.env');
    symlinkSync(real, link);
    const viaLink = check(link);
    assert.equal(viaLink.status, 1);
    assert.match(viaLink.output, /symlink/);
    const open = check(keyFile(dir, `GEMINI_API_KEY=${FAKE}\n`, 0o644));
    assert.equal(open.status, 1);
    assert.match(open.output, /mode 600/);
    const none = check(keyFile(dir, 'GEMINI_MODEL=gemini-3.1-flash-lite\n'));
    assert.equal(none.status, 1);
    assert.match(none.output, /no GEMINI_API_KEY= line/);
    for (const r of [viaLink, open, none]) assert.ok(!r.output.includes(FAKE));
  });
});

test('gemini-live.sh: refuses a key file whose directory others can write (they could swap the file)', () => {
  withDir(dir => {
    const file = keyFile(dir, `GEMINI_API_KEY=${FAKE}\n`);
    assert.equal(check(file).status, 0);
    chmodSync(dir, 0o770);
    const shared = check(file);
    assert.equal(shared.status, 1);
    assert.match(shared.output, /must not be writable by group or others/);
    chmodSync(dir, 0o700);
  });
});
