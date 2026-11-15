// src/cli/ddmin.ts — delta debugging (Zeller and Hildebrandt, 2002) for the fault-schedule fuzzer (P2-WP-02;
// PHASE2_EVALUATION §6.2). Generic and deterministic: no clock, no randomness, and the same (units, test) always gives
// the same tests in the same order. Complement-first, n-way split. Each distinct subset is tested at most once.
//
// Result: a subset on which `test` passes. When the search ends normally it is 1-minimal: removing any one unit makes
// `test` fail (every single-unit complement was tested and failed). When the budget of test calls runs out first,
// the best subset so far is returned with `oneMinimal: false`.

export interface DdminResult<T> {
  units: T[];
  /** Calls to `test` (the original full set is not re-tested). */
  tests: number;
  /** True only when every single-unit removal was tested and failed. */
  oneMinimal: boolean;
}

/**
 * Shrinks `units` (on which `test` is assumed to pass) to a 1-minimal subset on which it still passes, using at
 * most `budget` calls to `test`. Order is preserved: the result is a subsequence of `units`.
 */
export function ddmin<T>(units: readonly T[], test: (subset: T[]) => boolean, budget: number): DdminResult<T> {
  if (!Number.isInteger(budget) || budget < 0) throw new RangeError(`ddmin budget must be a non-negative integer, got ${budget}`);
  let current = units.map((_, i) => i);   // indices into units, ascending
  let tests = 0;
  const seen = new Map<string, boolean>();
  let exhausted = false;

  /** Tests a subset of indices once; null when the budget is spent. */
  const run = (indices: number[]): boolean | null => {
    const key = indices.join(',');
    const known = seen.get(key);
    if (known !== undefined) return known;
    if (tests >= budget) { exhausted = true; return null; }
    tests++;
    const ok = test(indices.map(i => units[i] as T));
    seen.set(key, ok);
    return ok;
  };

  let n = 2;
  while (current.length >= 2) {
    const chunks = split(current, n);
    let reduced = false;
    // Complements first: removing one chunk is the cheapest large step.
    for (let c = 0; c < chunks.length && !reduced; c++) {
      const complement = chunks.flatMap((chunk, i) => (i === c ? [] : chunk));
      const ok = run(complement);
      if (ok === null) break;
      if (ok) { current = complement; n = Math.max(n - 1, 2); reduced = true; }
    }
    if (exhausted) break;
    if (!reduced) {
      for (const chunk of chunks) {
        const ok = run(chunk);
        if (ok === null) break;
        if (ok) { current = chunk; n = 2; reduced = true; break; }
      }
    }
    if (exhausted) break;
    if (reduced) continue;
    if (n >= current.length) break;   // granularity 1 and no single removal passes: 1-minimal
    n = Math.min(n * 2, current.length);
  }
  // A single remaining unit is 1-minimal only if the empty set was shown to fail; test it if the budget allows.
  let oneMinimal = !exhausted;
  if (!exhausted && current.length === 1) {
    const ok = run([]);
    if (ok === null) oneMinimal = false;
    else if (ok) { current = []; }
  }
  return { units: current.map(i => units[i] as T), tests, oneMinimal };
}

/** Splits `items` into `n` contiguous chunks whose sizes differ by at most one (the first ones larger). */
function split<T>(items: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  const size = Math.floor(items.length / n);
  let extra = items.length % n;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const len = size + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.push(items.slice(at, at + len));
    at += len;
  }
  return out.filter(chunk => chunk.length > 0);
}
