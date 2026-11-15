// integrations/gateway/src/tiger/cli/import.ts
// Dry-run import CLI (TIG-04 offline part, #261). It imports a directory of RunRecord artifacts into the IN-MEMORY
// fake repository: there is no database driver in this build (pg is D3), so nothing is ever sent anywhere and the
// output is labelled FAKE IN-MEMORY REPOSITORY. Manifests and the ledger are real files under --state-dir (never
// inside --dir). Run it from the repository root:
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning \
//     --import ./integrations/gateway/loader/register.mjs integrations/gateway/src/tiger/cli/import.ts \
//     --dir results --dt-file src/contracts/params.ts --dt-commits <40-hex>[,<40-hex>…] [--state-dir <dir>] [--passes 2]
//
// `--dt-file` / `--dt-commits`: the operator vouches that those commits use that params.ts (RFC §8, TIG-D14; no git
// process is spawned). Without them every clean record is rejected with DT_UNVERIFIABLE.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createFakeRepository } from '../fakeRepository.ts';
import { importFiles, operatorDt, parseDt, type ArtifactFile } from '../importer.ts';
import { fileLedger } from '../ledgerFile.ts';
import { fileManifestStore } from '../manifestFile.ts';
import { checkSchemaName } from '../schemaName.ts';

const USAGE = 'usage: import.ts --dir <records dir> [--state-dir <dir>] [--dt-file <params.ts> --dt-commits <sha,...>] [--passes <1-5>] [--schema encore|tig_test_<12 hex>]';
const IMPORTER_VERSION = 'encore-gateway 0.0.0 (tiger import CLI, dry run)';

const FLAGS = new Set(['dir', 'state-dir', 'dt-file', 'dt-commits', 'passes', 'schema']);

function args(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i] ?? '';
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined) throw new Error(USAGE);
    const name = key.slice(2);
    if (!FLAGS.has(name)) throw new Error(`unknown flag --${name}\n${USAGE}`);
    if (out.has(name)) throw new Error(`--${name} given twice`);
    out.set(name, value);
  }
  return out;
}

/** True when `child` is `parent` or inside it, comparing whole path segments (so `results/..state` is not `..`). */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) return false;
  return !/^([A-Za-z]:|[\\/])/.test(rel);   // another drive or root: outside
}

/** Top-level `*.json` with `v`, sorted, like runReport; regular files only (lstat refuses symlinks); inside `dir`. */
function scan(dir: string, cwd: string): ArtifactFile[] {
  const root = resolve(dir);
  const files: ArtifactFile[] = [];
  for (const name of readdirSync(root).filter(n => n.endsWith('.json')).sort()) {
    const path = join(root, name);
    if (!lstatSync(path).isFile()) continue;
    const bytes = new Uint8Array(readFileSync(path));
    files.push({ path: relative(cwd, path).replace(/\\/g, '/'), bytes });
  }
  return files;
}

async function main(argv: readonly string[], cwd: string): Promise<number> {
  const opts = args(argv);
  const dir = opts.get('dir');
  if (!dir) throw new Error(USAGE);
  const stateDir = resolve(opts.get('state-dir') ?? 'integrations/gateway/src/tiger/state');
  // Never write manifests or the ledger inside the records directory or the repo's results/ (TCR-22).
  if (within(resolve(dir), stateDir)) throw new Error('--state-dir must not be inside --dir');
  if (within(resolve(cwd, 'results'), stateDir)) throw new Error('--state-dir must not be inside results/');
  const passes = Number(opts.get('passes') ?? '1');
  if (!Number.isSafeInteger(passes) || passes < 1 || passes > 5) throw new Error(USAGE);
  const schema = checkSchemaName(opts.get('schema') ?? 'encore');   // `Encore` must not slip past the DEV_SEED policy
  const dtFile = opts.get('dt-file');
  if (opts.has('dt-commits') && !dtFile) throw new Error('--dt-commits needs --dt-file');
  const dtSeconds = dtFile ? parseDt(readFileSync(dtFile, 'utf8')) : null;
  if (dtFile && dtSeconds === null) throw new Error('--dt-file has no `export const DT = <seconds>;` line');
  const commits = (opts.get('dt-commits') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (commits.some(c => !/^[0-9a-f]{40}$/.test(c))) throw new Error('--dt-commits takes 40-hex commit ids');

  const now = () => new Date().toISOString();
  const deps = {
    repo: createFakeRepository(now),
    manifests: fileManifestStore(stateDir),
    ledger: fileLedger(join(stateDir, 'imports.ndjson')),
    sha256: (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex'),
    sha1: (data: Uint8Array) => createHash('sha1').update(data).digest('hex'),
    now,
    attemptId: () => randomUUID(),
    dtFor: operatorDt(dtSeconds, commits),
    schema,
    importerVersion: IMPORTER_VERSION,
  };
  const files = scan(dir, cwd);
  process.stdout.write(`FAKE IN-MEMORY REPOSITORY (dry run): nothing is sent to Tiger. ${files.length} files from ${dir}; state in ${relative(cwd, stateDir) || '.'}\n`);
  for (let pass = 1; pass <= passes; pass++) {
    const report = await importFiles(files, deps);
    const codes: Record<string, number> = {};
    for (const r of report.results) if (r.code) codes[r.code] = (codes[r.code] ?? 0) + 1;
    const { results: _results, ...counts } = report;
    void _results;
    process.stdout.write(`${JSON.stringify({ pass, ...counts, codes, rows: deps.repo.counts() })}\n`);
  }
  return 0;
}

main(process.argv.slice(2), resolve('.')).then(
  code => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
