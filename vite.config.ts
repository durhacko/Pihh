import { defineConfig } from 'vitest/config';

/**
 * Lane 3 (P0): a NARROW dev-server proxy from the Vite dev server to the optional local gateway
 * (integrations/gateway), so the app at http://127.0.0.1:5173 reaches it same-origin.
 *
 * - Dev server only (`server.proxy`). `npm run build` and `vite preview` are unchanged, so the default build still
 *   makes no request to the gateway and nothing here reaches the bundle.
 * - Exactly two paths, matched in full: GET /api/health and POST /api/generate-formation. Everything else under
 *   /api (for example /api/shows, /api/runs) is NOT proxied.
 * - The gateway's guard stays on. `changeOrigin` sets Host to 127.0.0.1:<GATEWAY_PORT>, which is what its Host
 *   check allows. The browser's own Origin is forwarded UNCHANGED (never rewritten), so the gateway still judges the
 *   real origin against GATEWAY_ALLOWED_ORIGINS: start it with GATEWAY_ALLOWED_ORIGINS set to the dev origin, e.g.
 *   GATEWAY_ALLOWED_ORIGINS=http://127.0.0.1:5173. A page on any other origin is refused there, as before.
 * - The launch token is never added here: the user types it into the Composer field from the gateway's start line,
 *   and the app sends it as `Authorization: Bearer <token>`, which the proxy passes through.
 * - GATEWAY_PORT comes from the dev shell (default 8787, the gateway's own default). It is read by this config only and
 *   is not a VITE_* variable, so it is never inlined into the app.
 */
export const GATEWAY_PROXY_PATHS = ['^/api/health(\\?.*)?$', '^/api/generate-formation(\\?.*)?$'] as const;

export function gatewayTarget(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.GATEWAY_PORT ?? '').trim();
  const port = /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 65_535 ? Number(raw) : 8787;
  return `http://127.0.0.1:${port}`;
}

export default defineConfig({
  base: './',
  server: {
    proxy: Object.fromEntries(GATEWAY_PROXY_PATHS.map(path => [path, { target: gatewayTarget(), changeOrigin: true }])),
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'] },
});
