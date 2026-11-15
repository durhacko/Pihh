// integrations/gateway/loader/resolve.mjs
// A Node resolve hook (module.register, async hooks: Node >= 20.6, so the root's 22.12 floor holds). Skeleton-owned.
//
// Why: modules import the pure app code in the repo's `src/` by relative path (XI-2), and `src/` is written for the
// bundler, with extensionless imports (`'../../score'`, `'./font'`). Node's ESM resolver refuses those. This hook
// retries a failed relative import as `<path>.ts`, then `<path>/index.ts`, **only when the importing file is inside
// the repo's `src/`**. Gateway code itself must keep writing explicit `.ts` extensions; nothing else changes.

const SRC_ROOT = new URL('../../../src/', import.meta.url).href;
const RETRY = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);

/** True for `./x`, `../x/y` with no extension on the last segment. */
function extensionlessRelative(specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const last = specifier.slice(specifier.lastIndexOf('/') + 1);
  return last !== '' && last !== '.' && last !== '..' && !last.includes('.');
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const parent = context.parentURL ?? '';
    if (!RETRY.has(error?.code) || !parent.startsWith(SRC_ROOT) || !extensionlessRelative(specifier)) throw error;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // try the next form
      }
    }
    throw error;
  }
}
