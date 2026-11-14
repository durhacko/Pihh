// Run manually after the implementation dependencies land:
// node tests/isolation/check-mutations.mjs
// Every mutation happens in a new disposable copy, never in a working tree.
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tempParent = resolve(tmpdir());
const workspace = await mkdtemp(join(tempParent, 'encore-20-mutations-'));
if (dirname(workspace) !== tempParent || !basename(workspace).startsWith('encore-20-mutations-')) {
  throw new Error('Refusing unsafe mutation workspace');
}

const mutants = [
  {
    name: 'T02 live roster leaked into local input', selector: 'T02',
    from: 'tick, pos: clone(body.pos), vel: clone(body.vel), inbox: inboxes[id],',
    to: 'tick, pos: clone(body.pos), vel: clone(body.vel), inbox: inboxes[id], rosterLeak: live.length,',
  },
  {
    name: 'T03 radio uses reversed brain order', selector: 'T03',
    from: 'for (const id of live) for (const message of outputs.get(id)!.outbox)',
    to: 'for (const id of test.reverseStepOrder ? [...live].reverse() : live) for (const message of outputs.get(id)!.outbox)',
  },
  {
    name: 'T04 radio RNG is unseeded', selector: 'replaying the same seed',
    from: 'const rng = createRandom(hashSeed(source.seed, -1));',
    to: 'const rng = Math.random;',
  },
  {
    name: 'T05 radio jam incorrectly stops baseline motion', selector: 'T05',
    from: 'const acceleration = clampLength(outputs.get(id)!.accel, params.aMax);',
    to: 'const acceleration = clampLength(jams.size ? [0, 0, 0] : outputs.get(id)!.accel, params.aMax);',
  },
];

function run(selector) {
  const args = [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/isolation/isolation.test.ts'];
  if (selector) args.push('-t', selector);
  const result = spawnSync(process.execPath, args, { cwd: workspace, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.signal) throw new Error(`Mutation runner failed: ${result.error ?? result.signal}`);
  return result;
}

try {
  for (const entry of ['src', 'tests', 'package.json', 'tsconfig.json', 'vite.config.ts']) {
    await cp(join(root, entry), join(workspace, entry), { recursive: true });
  }
  await symlink(join(root, 'node_modules'), join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const baseline = run();
  if (baseline.status !== 0) {
    process.stdout.write(baseline.stdout + baseline.stderr);
    throw new Error('Unmodified isolation suite must pass before mutation checks');
  }
  console.log('Unmodified isolation suite passed.');
  const worldPath = join(workspace, 'src/sim/world.ts');
  const original = await readFile(worldPath, 'utf8');
  for (const mutant of mutants) {
    if (original.split(mutant.from).length !== 2) throw new Error(`Update mutation target: ${mutant.name}`);
    await writeFile(worldPath, original.replace(mutant.from, mutant.to));
    const result = run(mutant.selector);
    await writeFile(worldPath, original);
    if (result.status === 0) throw new Error(`SURVIVED: ${mutant.name}`);
    if (!result.stdout.includes('AssertionError') && !result.stderr.includes('AssertionError') &&
        !result.stdout.includes('AgentInput exposes') && !result.stderr.includes('AgentInput exposes')) {
      process.stdout.write(result.stdout + result.stderr);
      throw new Error(`Mutant failed for an unexpected reason: ${mutant.name}`);
    }
    console.log(`DETECTED: ${mutant.name}`);
  }
} finally {
  // Unlink the dependency junction before removing the verified task-specific copy.
  await rm(join(workspace, 'node_modules'), { force: true, recursive: process.platform === 'win32' });
  await rm(workspace, { recursive: true, force: true });
}
