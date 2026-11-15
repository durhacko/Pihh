// src/app/live/generate.ts: the app's client for the gateway's `gemini` module, `POST /api/generate-formation`
// (GF-WP-10 step 2 / #213; gemini spec §10.1). XI-14: under src/app, only src/app/live/ uses a network API.
//
// Off by default, twice over:
// - build time: only a build with VITE_GENERATE_LIVE === '1' (a non-secret flag) offers it;
// - run time: only with `?p2=generated,live`.
// Otherwise no instance exists, nothing is ever sent, and the tab says "live Gemini unavailable (D3 not granted)". With
// a client, the gateway's own answer is reported: the shipped gateway answers 503 PROVIDER_UNAVAILABLE /
// MODULE_DISABLED, shown as "live Gemini unavailable (gateway: MODULE_DISABLED)". It never presents anything as Gemini
// output unless the gateway names a Gemini model: the gateway's offline test provider (model `offline-fake`) is always
// labelled as not Gemini. The gateway sends no CORS headers, so the page must be served from the gateway's origin or
// through a dev proxy for `/api` (vite.config has none); otherwise every call reads "gateway unreachable".
//
// No secret is ever in the bundle: the per-launch gateway token (GATEWAY_REQUIRE_TOKEN) is typed in at run time, held
// in memory only and sent as `Authorization: Bearer`. Provider keys live only in the gateway's environment.
// The returned scene is untrusted data: the caller re-validates it (validateScene) and compiles it in the preview
// worker; the gateway's sceneHash is advisory and never trusted (spec §6.7, CR-26).

export type LiveMode = 'silhouette2d' | 'scene3d';

/** The honest state when this page offers no live generation at all (no client: the build or URL flag is off). */
export const D3_UNAVAILABLE = 'live Gemini unavailable (D3 not granted)';
/** The state when the gateway answered that it cannot generate: its own reason, never a guess about why. */
export const gatewayUnavailable = (reason: string): string => `live Gemini unavailable (gateway: ${reason})`;
/** The state when the gateway could not be reached at all (down, wrong origin, or the browser's CORS refusal). */
export const GATEWAY_UNREACHABLE = 'live Gemini unavailable (gateway unreachable)';

export interface ErrorDetail { path: string; reason: string }

export type GenerateOutcome =
  | { ok: true; scene: unknown; model: string; provider: string; gemini: boolean; mode: LiveMode; latencyMs: number; requestId?: string }
  | {
      ok: false;
      /** `unavailable`: the gateway says it cannot generate, or cannot be reached; `cancelled`: the caller aborted. */
      kind: 'unavailable' | 'rejected' | 'timeout' | 'invalid-response' | 'cancelled';
      status: number; code: string; message: string; details: ErrorDetail[];
    };

export interface GenerateClientOptions {
  /** Default: the global fetch. Tests pass a fake. */
  fetch?: typeof fetch;
  /** Origin of the gateway (default: same origin). The gateway sends no CORS headers, so cross-origin calls fail. */
  base?: string;
  /** Per-launch token, typed in by the operator; never persisted. */
  token?: string;
  /** Abort after this long (default 50 s: the gateway's own deadline is 45 s, §10.3). */
  timeoutMs?: number;
}

export interface GenerateClient {
  /** `token` (typed in at run time) overrides the option's; it is sent as `Authorization: Bearer` and never stored.
   *  `signal` lets the caller abort the request (a newer request, a cancel, or dispose). */
  generate(request: { prompt: string; mode: LiveMode; requestId?: string; token?: string; signal?: AbortSignal }): Promise<GenerateOutcome>;
}

/** The provider label shown next to a generated scene. Only a model id that starts with `gemini` is called Gemini. */
export function providerLabel(model: string): { provider: string; gemini: boolean } {
  const gemini = /^gemini[a-z0-9.-]*$/i.test(model);
  return gemini ? { provider: `live Gemini (${model})`, gemini } : { provider: `${model} provider (not Gemini)`, gemini };
}

/** Whether this page offers live generation: the build flag AND `?p2=…,live`. */
export function liveGenerationEnabled(buildFlag: string | undefined, search: string | null): boolean {
  if (buildFlag !== '1' || search === null) return false;
  const value = new URLSearchParams(search).get('p2');
  return value !== null && value.split(',').map(part => part.trim()).includes('live');
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function readDetails(error: Record<string, unknown>): ErrorDetail[] {
  if (!Array.isArray(error.details)) return [];
  return error.details.filter(isObject).map(d => ({ path: typeof d.path === 'string' ? d.path : '', reason: typeof d.reason === 'string' ? d.reason : '' })).slice(0, 20);
}

export function createGenerateClient(options: GenerateClientOptions = {}): GenerateClient {
  return {
    async generate({ prompt, mode, requestId, token, signal }) {
      const doFetch = options.fetch ?? globalThis.fetch;
      const cancelled = (): GenerateOutcome => ({ ok: false, kind: 'cancelled', status: -2, code: 'CANCELLED', message: 'The request was cancelled.', details: [] });
      if (signal?.aborted) return cancelled();
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 50_000);
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
      const bearer = token ?? options.token;
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      let status = 0;
      let body: unknown = null;
      try {
        const res = await doFetch(`${options.base ?? ''}/api/generate-formation`, {
          method: 'POST', headers, body: JSON.stringify(requestId ? { prompt, mode, requestId } : { prompt, mode }),
          signal: controller.signal, credentials: 'same-origin',
        });
        status = res.status;
        try { body = await res.json(); } catch { body = null; }
      } catch {
        if (signal?.aborted) return cancelled();
        const timedOut = controller.signal.aborted;
        return timedOut
          ? { ok: false, kind: 'timeout', status: -1, code: 'TIMEOUT', message: 'The gateway did not answer in time.', details: [] }
          : { ok: false, kind: 'unavailable', status: 0, code: 'UNREACHABLE', message: GATEWAY_UNREACHABLE, details: [] };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (signal?.aborted) return cancelled();
      if (status === 200 && isObject(body) && typeof body.model === 'string' && (body.mode === 'silhouette2d' || body.mode === 'scene3d') && isObject(body.scene)) {
        const label = providerLabel(body.model);
        return {
          ok: true, scene: body.scene, model: body.model, ...label, mode: body.mode,
          latencyMs: typeof body.modelLatencyMs === 'number' ? body.modelLatencyMs : 0,
          ...(typeof body.requestId === 'string' ? { requestId: body.requestId } : {}),
        };
      }
      const error = isObject(body) && isObject(body.error) ? body.error : null;
      if (!error) return { ok: false, kind: 'invalid-response', status, code: 'INVALID_RESPONSE', message: `The gateway answered ${status} without a usable body.`, details: [] };
      const code = typeof error.code === 'string' ? error.code : 'INTERNAL';
      const details = readDetails(error);
      const message = typeof error.message === 'string' ? error.message : '';
      if (code === 'PROVIDER_UNAVAILABLE' || details.some(d => d.reason === 'MODULE_DISABLED')) {
        // The gateway's own reason (MODULE_DISABLED for the shipped gateway), not a claim about why it is off.
        const reason = details.find(d => d.reason)?.reason ?? code;
        return { ok: false, kind: 'unavailable', status, code, message: gatewayUnavailable(reason), details };
      }
      if (code === 'TIMEOUT') return { ok: false, kind: 'timeout', status, code, message: message || 'The model did not answer in time.', details };
      return { ok: false, kind: 'rejected', status, code, message, details };
    },
  };
}
