// MDB-WP-02 (#230), extends MDB-T09: src/app/compose/validate.ts is pure, so the optional gateway can import it by
// relative path (XI-2, XI-13). Transitive import scan: every module it reaches must be under src/contracts or src/score
// (src/score/font and src/score/canonical included), with no bare package (three, mongodb, …), no node:*, no dynamic
// import or require, no DOM, network or process globals, and no clock or unseeded randomness (Date, performance,
// Math.random in any spelling, or a bare Math binding). Negative controls: the scan catches commands.ts reaching
// src/app/actions and src/sim, and an inline fixture shows each clock and randomness spelling is flagged.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Network, DOM and process globals, plus the clock and unseeded randomness (#240 review): validation must be deterministic.
const BANNED_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'require', 'Buffer', '__dirname', 'globalThis', 'Date', 'performance'];
const BANNED_MATH = ['random'];   // Math.random and Math['random']
const ALLOWED_DIRS = ['src/contracts/', 'src/score/'];

function resolveModule(fromFile: string, spec: string): string | null {
  const base = resolve(root, dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, resolve(base, 'index.ts'), base]) if (existsSync(candidate) && candidate.endsWith('.ts')) return relative(root, candidate).replaceAll('\\', '/');
  return null;
}

/** `node` with any parentheses around it stripped, walking up: `((Math))` → the outermost parenthesised expression. */
function outermostParens(node: ts.Node): ts.Node {
  let n = node;
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent;
  return n;
}

/**
 * The per-file checks of the scan, on source text: imports (passed to `follow`), dynamic import, `import =`, banned
 * globals, Math.random in any spelling (`Math.random`, `Math['random']`, `(Math).random`), a computed `Math[k]`,
 * and a bare `Math` binding that is not a property receiver (`const { random } = Math`, `const m = Math`).
 */
function checkSource(file: string, source: string, follow: (spec: ts.Node | undefined) => void = () => {}): string[] {
  const problems: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) follow(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) follow(node.argument.literal);
    if (ts.isImportEqualsDeclaration(node)) problems.push(`${file}: import =`);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push(`${file}: dynamic import`);
    if (ts.isIdentifier(node) && BANNED_GLOBALS.includes(node.text)) problems.push(`${file}: global ${node.text}`);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      let receiver: ts.Expression = node.expression;
      while (ts.isParenthesizedExpression(receiver)) receiver = receiver.expression;   // (Math).random, ((Math))['random']
      if (ts.isIdentifier(receiver) && receiver.text === 'Math') {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : '<computed>';
        if (BANNED_MATH.includes(key) || key === '<computed>') problems.push(`${file}: Math.${key}`);
      }
    }
    if (ts.isIdentifier(node) && node.text === 'Math') {
      const p = node.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node);
      const top = outermostParens(node);
      const isReceiver = (ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent)) && top.parent.expression === top;
      if (!isName && !isReceiver) problems.push(`${file}: bare Math`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return problems;
}

/** Walks the import graph from `entry`; returns every reached file and every problem found. */
function scan(entry: string): { files: string[]; problems: string[] } {
  const seen = new Set<string>();
  const problems: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const follow = (spec: ts.Node | undefined) => {
      if (!spec || !ts.isStringLiteralLike(spec)) { problems.push(`${file}: non-literal module specifier`); return; }
      const text = spec.text;
      if (!text.startsWith('.')) { problems.push(`${file}: package import ${text}`); return; }
      const target = resolveModule(file, text);
      if (!target) { problems.push(`${file}: unresolved ${text}`); return; }
      queue.push(target);
    };
    problems.push(...checkSource(file, readFileSync(resolve(root, file), 'utf8'), follow));
  }
  const files = [...seen].sort();
  for (const f of files) if (f !== entry && !ALLOWED_DIRS.some(d => f.startsWith(d))) problems.push(`reaches ${f}`);
  return { files, problems };
}

describe('src/app/compose/validate.ts is pure (XI-2, XI-13)', () => {
  it('reaches only src/contracts and src/score: no three, node:*, network, DOM, src/sim, src/app/actions or src/app/ui', () => {
    const { files, problems } = scan('src/app/compose/validate.ts');
    expect(problems).toEqual([]);
    expect(files).toContain('src/score/font.ts');
    expect(files).toContain('src/score/expand.ts');
    expect(files.some(f => /src\/(sim|agent|observer|cli|app\/(actions|ui|render))/.test(f))).toBe(false);
  });

  it('negative control: the same scan flags commands.ts, which reaches src/app/actions and src/sim', () => {
    const { files, problems } = scan('src/app/ui/commands.ts');
    expect(files).toContain('src/app/actions.ts');
    expect(files.some(f => f.startsWith('src/sim/'))).toBe(true);
    expect(problems.some(p => p === 'reaches src/app/actions.ts')).toBe(true);
  });

  it('negative control: the checker flags every spelling of the clock and Math.random in an inline fixture', () => {
    const fixture = [
      'export const a = Math.random();',
      "export const b = Math['random']();",
      'const k = "random"; export const c = Math[k]();',   // parsed, not typechecked
      'export const d = new Date();',
      'const { random } = Math; export const e = random;',
      'export const f = (Math).random();',
      'export const g = ((Math))["random"];',
      'export const h = performance.now();',
      'export const ok = Math.sqrt(2) + Math.floor(1.5);',   // allowed: a receiver of a non-banned member
    ].join('\n');
    expect(checkSource('fixture.ts', fixture).sort()).toEqual([
      'fixture.ts: Math.random',      // a: Math.random()
      'fixture.ts: Math.random',      // b: Math['random']()
      'fixture.ts: Math.random',      // f: (Math).random()
      'fixture.ts: Math.random',      // g: ((Math))["random"]
      'fixture.ts: Math.<computed>',  // c: Math[k]()
      'fixture.ts: bare Math',        // e: const { random } = Math
      'fixture.ts: global Date',      // d: new Date()
      'fixture.ts: global performance',   // h: performance.now()
    ].sort());
    expect(checkSource('plain.ts', 'export const m = Math.max(1, 2); const o = { Math: 1 }; export const n = o.Math;')).toEqual([]);
  });

  it('negative control: the scan also fires on a real file, the app shell, which reads performance', () => {
    const { problems } = scan('src/app/main.ts');
    expect(problems).toContain('src/app/main.ts: global performance');
  });

  it('commands.ts keeps only an import and a re-export of the moved validateText and TEXT_MAX', () => {
    const source = readFileSync(resolve(root, 'src/app/ui/commands.ts'), 'utf8');
    expect(source).not.toMatch(/export (const TEXT_MAX|function validateText)/);
    expect(source).toContain("export { TEXT_MAX, validateText } from '../compose/validate';");
  });
});
