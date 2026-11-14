import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = {
  contracts: ['contracts'], score: ['score', 'contracts'],
  agent: ['agent', 'contracts', 'score'], sim: ['sim', 'contracts'],
  observer: ['observer', 'contracts', 'score'],
};

export function violations(source, filename) {
  const own = filename.replaceAll('\\', '/').split('/')[1];
  if (!allowed[own]) return [];
  const errors = [];
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function check(specifier) {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      errors.push(`${filename}: non-literal module loading is forbidden in core`);
      return;
    }
    const target = specifier.text;
    const destination = target.startsWith('.')
      ? relative(root, resolve(root, dirname(filename), target)).replaceAll('\\', '/')
      : target;
    const parts = destination.split('/');
    if (parts[0] !== 'src' || !allowed[own].includes(parts[1])) {
      errors.push(`${filename}: forbidden import ${target}`);
    }
  }
  function visit(node) {
    if (ts.isImportTypeNode(node)) {
      check(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) check(node.moduleSpecifier);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      check(node.moduleReference.expression);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) check(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return errors;
}

async function scan(dir) {
  const errors = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) errors.push(...await scan(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      errors.push(...violations(await readFile(path, 'utf8'), relative(root, path)));
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await scan(resolve(root, 'src'));
  errors.forEach(error => console.error(error));
  if (errors.length) process.exitCode = 1;
  else console.log('Import boundaries passed.');
}
