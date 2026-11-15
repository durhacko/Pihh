// Types for loader/resolve.mjs (tests import it directly).
export interface ResolveContext { parentURL?: string; conditions?: string[]; importAttributes?: Record<string, string> }
export interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
export type NextResolve = (specifier: string, context: ResolveContext) => Promise<ResolveResult>;
export function resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): Promise<ResolveResult>;
