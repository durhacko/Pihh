import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed: Record<string, string[]> = {
  contracts: ['contracts'], score: ['score', 'contracts'],
  agent: ['agent', 'contracts', 'score'], sim: ['sim', 'contracts'],
  observer: ['observer', 'contracts', 'score'],
  telemetry: ['telemetry', 'contracts', 'score'],
};

function violations(source: string, filename: string): string[] {
  const own = filename.replaceAll('\\', '/').split('/')[1];
  if (!allowed[own]) return [];
  const errors: string[] = [];
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function check(specifier: ts.Node | undefined) {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      errors.push(`${filename}: non-literal module loading is forbidden in core`);
      return;
    }
    const target = specifier.text;
    const destination = target.startsWith('.')
      ? relative(root, resolve(root, dirname(filename), target)).replaceAll('\\', '/') : target;
    const parts = destination.split('/');
    if (parts[0] !== 'src' || !allowed[own].includes(parts[1])) errors.push(`${filename}: forbidden import ${target}`);
    else if (own === 'telemetry' && parts[1] === 'score' && !['canonical', 'font'].includes(parts.slice(2).join('/').replace(/\.[cm]?[jt]sx?$/, ''))) {
      errors.push(`${filename}: forbidden import ${target}`);   // telemetry may use only score/canonical and score/font (TCR-27)
    }
  }
  function visit(node: ts.Node) {
    if (ts.isImportTypeNode(node)) check(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) check(node.arguments[0]);
    if (ts.isIdentifier(node) && ['window', 'document'].includes(node.text)) errors.push(`${filename}: DOM access ${node.text}`);
    if (own === 'agent') {
      if (ts.isIdentifier(node) && ['Date', 'performance'].includes(node.text)) errors.push(`${filename}: unseeded clock ${node.text}`);
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) && node.expression.text === 'Math') {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text :
          ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (key === 'random') errors.push(`${filename}: unseeded Math.random`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return errors;
}

async function scan(dir: string): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) errors.push(...await scan(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) errors.push(...violations(await readFile(path, 'utf8'), relative(root, path)));
  }
  return errors;
}

describe('core import isolation', () => {
  it('T01: checks every source file against the component boundaries', async () => {
    expect(await scan(resolve(root, 'src'))).toEqual([]);
  });
  it.each(['window.location', 'document.body', 'globalThis.document'])('rejects core DOM access: %s', source => {
    expect(violations(source, 'src/sim/world.ts').length).toBeGreaterThan(0);
  });
  it.each(['Math.random()', "Math['random']()", 'Date.now()', 'performance.now()'])('rejects unseeded brain clock/random: %s', source => {
    expect(violations(source, 'src/agent/brain.ts').length).toBeGreaterThan(0);
  });
  it('allows contracts, score, and private brain helpers', () => {
    expect(violations("import type { Input } from '../contracts/types'; import './state'; export { x } from '../score/index';", 'src/agent/brain.ts')).toEqual([]);
  });
  it.each([
    "import { world } from '../sim/world';",
    "export { world } from '../sim/world';",
    "const world = import('../sim/world');",
    "const world = require('../sim/world');",
    "import World = require('../sim/world');",
    "type World = import('../sim/world').World;",
    "import * as three from 'three';",
    "import x from '../../outside';",
    "import x from '@/sim/world';",
    'const x = import(path);',
  ])('rejects forbidden brain dependency: %s', source => {
    expect(violations(source, 'src/agent/brain.ts')).toHaveLength(1);
  });
  it('keeps the world independent of brain implementations', () => {
    expect(violations("import { brain } from '../agent/brain';", 'src/sim/world.ts')).toHaveLength(1);
  });
  it('allows the app to assemble components', () => {
    expect(violations("import * as three from 'three';", 'src/app/main.ts')).toEqual([]);
  });
  it('lets telemetry import only score/canonical and score/font from src/score', () => {
    expect(violations("import { canonicalJson } from '../score/canonical'; import { FONT } from '../score/font';", 'src/telemetry/x.ts')).toEqual([]);
    expect(violations("import { composeNext } from '../score/compose';", 'src/telemetry/x.ts')).toHaveLength(1);
  });
});
