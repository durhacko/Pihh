# Encore gateway (optional, offline skeleton)

This is the one shared optional gateway of [boundaries §6.2](../../docs/design/OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard) (XI-12, XI-20), issue #218. It has one server, one guard, one error envelope, one config and one `GET /api/health`. Every integration plugs in as a module:

- `gemini` ([GF-WP-12](../../docs/planning/gemini-integration-work-packages.md#gf-wp-12-gemini-module-of-the-optional-gateway-x-runlive--interface-only), #117);
- `shows` (MongoDB Atlas, MDB-WP-03, #130);
- `tiger` (Tiger Data, TIG-03, #142).

**Status: offline skeleton.**
- It has zero dependencies, no SDK and no outbound network code. A test enforces this.
- The server listens on `127.0.0.1` only, when someone runs it by hand.
- **Every module is disabled in this build.** `gemini` is interface-only and answers 503 `PROVIDER_UNAVAILABLE` / `MODULE_DISABLED`. `shows` and `tiger` are placeholders their lanes replace.
- Encore does not use the gateway. Nothing in `src/`, `tests/` or the build imports `integrations/` (a test checks this). Deleting the folder changes nothing for the app, the CLI or `bash scripts/check.sh`.
- **Gates.** It merges into `phase2/development` only. A live provider, a database driver or any app-side client waits for **P2-G6** and that integration's own **D3** (boundaries §9; GF-D1 for Gemini, MDB-D1 for MongoDB, the Tiger D3 for Tiger Data).

## Who owns what

| Path | Owner | Notes |
|---|---|---|
| `src/server.ts`, `guard.ts`, `errors.ts`, `config.ts`, `health.ts`, `module.ts`, `modules.ts`, `router.ts` | skeleton (#218) | Single writer: the #218 worker. Lanes never edit these |
| `test/*.test.ts` (top level), `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, this README | skeleton (#218) | |
| `src/gemini/`, `test/gemini/` | Gemini lane (#117) | Interface-only today (GF-WP-12) |
| `src/shows/`, `test/shows/` | MongoDB lane (#130) | `module.ts` is a placeholder to replace |
| `src/tiger/`, `test/tiger/` | Tiger Data lane (#142) | `module.ts` is a placeholder to replace. `src/tiger-live/server.ts` exists only if OIB-Q5 is accepted |

A lane that needs a skeleton change (a new shared helper, a guard rule, a registry entry) asks the #218 owner. It does not edit the file.

## The module plug-in interface

A module is the folder `src/<name>/`. Its entry point is `src/<name>/module.ts`, which exports `createModule`. The registry, `src/modules.ts`, already imports all three entry points, so a lane plugs in by replacing its own `module.ts` and changes no skeleton file.

```ts
// src/<name>/module.ts
import type { Env } from '../config.ts';
import { errorResponse } from '../errors.ts';
import type { GatewayModule, ModuleFactory } from '../module.ts';

export const createModule: ModuleFactory = (env: Env): GatewayModule => ({
  name: 'shows',                                   // must equal the registry name
  routes: [
    { method: 'GET', path: '/api/shows/:id', handle: async req => ({ status: 200, body: { id: req.params.id } }) },
  ],
  health: () => ({ enabled: false, db: 'disabled', writable: false }),
});
```

The rules, all enforced by `src/router.ts` and its tests:

- **Environment.** `env` holds only the module's own prefix: `GEMINI_*`, `MONGODB_*` or `TIGER_*`. A module cannot read another module's secret or a gateway setting. Wrap secrets in `secret()` (`config.ts`), which never prints its value. Document the variables, names only, in `src/<name>/.env.example`.
- **Missing configuration is not an error.** A module with no key is a disabled module: it still registers its routes and answers its own `MODULE_DISABLED`. A factory that throws disables that module only, and the gateway records a problem that names no value.
- **Routes.**
  - Paths start with `/api/`. Segments are lower-case literals or `:params`.
  - `GET /api/health` belongs to the skeleton.
  - A route that collides with an earlier module's route, a bad path or method, or a module that reports the wrong `name` disables that module only.
- **Requests.** `handle(req)` receives `{ method, path, params, query, rawBody }` only after the guard has passed. The module parses and validates `rawBody` itself and never re-implements the guard.
  - `rawBody` is decoded as strict UTF-8 and capped at `GATEWAY_MAX_BODY_BYTES` (64 KiB by default) while streaming.
  - A module with a smaller limit, such as gemini's 8 KiB, checks it itself.
- **Responses.** Return `{ status, body }`. A success body has no `success` flag. Every failure uses `errorResponse(code, message, { details, requestId, status })` from `errors.ts`:
  - `code` is from the shared list of 14;
  - `details[].reason` is SCREAMING_SNAKE (XI-16);
  - `requestId` follows XI-11 and is echoed only if it matches;
  - messages are your own, never upstream text, and are sanitised.

  A handler that throws gives that request 500 `INTERNAL`, without its message.
- **Health.** `health()` returns `{ enabled: boolean, ...fields from your spec }`. Report `enabled: true` only when the module can actually answer. Never include a secret or a reason for being disabled. A `health()` that throws reads as `{ enabled: false }`.
- **Imports.** A module imports only `../*.ts` skeleton files, its own folder, and, under XI-2, the pure `src/` modules its spec allows, by relative path.
  - No packages until its D3, then exact pins, `npm ci --ignore-scripts`, a 14-day release age and `npm audit signatures` (XI-12).
  - Each module's tests must keep `test/offline.test.ts` green until its live PR deliberately relaxes it for one provider file.

## The guard (`src/guard.ts`), in order

1. **Peer:** loopback only (`127.0.0.0/8`, `::1`); otherwise 403 `NON_LOOPBACK_PEER`.
2. **Host:** exactly `127.0.0.1:<port>` or `localhost:<port>`; otherwise 403 `HOST_NOT_ALLOWED`. This defeats DNS rebinding.
3. **Token** (only with `GATEWAY_REQUIRE_TOKEN`): `Authorization: Bearer <per-launch token>` on every route except `GET /api/health`; otherwise 401 `TOKEN_MISSING`. The token is made at start and printed once.
4. **Origin:** every non-GET needs an Origin exactly in `GATEWAY_ALLOWED_ORIGINS`.
   - A missing or `null` Origin is 403 `ORIGIN_MISSING`.
   - Any other Origin is 403 `ORIGIN_NOT_ALLOWED`.
   - The list is empty by default, so every non-GET is refused until the operator names the app's origin.
5. **Content-Type:** any body must be `application/json` (optionally `charset=utf-8`); otherwise 415 `NOT_JSON`. This forces a CORS preflight, which never succeeds because no CORS headers are sent (OIB-Q2).
6. **Size:** a declared `Content-Length` over the cap is 413 before reading. Otherwise bytes are counted while streaming (413 `REQUEST_TOO_LARGE`). Invalid UTF-8 is 400 `INVALID_JSON`.

The server binds `127.0.0.1` only. `GATEWAY_BIND` set to any other address refuses to start, because a non-loopback bind needs server-side authorisation (MDB-D3), which this build does not have.

## Configuration

Environment only, read by the gateway process. Nothing is committed, bundled or loaded from a file. The gateway's own settings are in [`.env.example`](.env.example): `GATEWAY_PORT`, `GATEWAY_BIND`, `GATEWAY_ALLOWED_ORIGINS`, `GATEWAY_REQUIRE_TOKEN` and `GATEWAY_MAX_BODY_BYTES`. Each module's settings are in `src/<name>/.env.example`.

## Running and checks

From this folder, with Node 22.12 or later. No install is needed: there are no packages.

```bash
npm test                               # node:test with type stripping; every test/**/*.test.ts
npm run typecheck                      # = npx --no-install tsc -p tsconfig.json (the root repo's TypeScript)
GATEWAY_ALLOWED_ORIGINS=http://localhost:5173 npm start   # listens on http://127.0.0.1:8787
```

- **Not part of the root `bash scripts/check.sh` yet.** The root vitest covers only `tests/**`, and the root `tsc` covers only `src`, `tests` and `vite.config.ts`. Wiring `npm test` and `typecheck` into `check.sh` needs the orchestrator's sign-off.
- **Root ESLint.** The root `eslint .` does lint these files, with the root config. P2-WP-30b's `integrations/` ignore (owner sign-off, XI-1) would stop that. If it lands, the gateway needs its own lint step.
- `test/server.test.ts` opens real sockets on `127.0.0.1`, port 0, and sends requests only to them. No test leaves the machine.

## Open points for Arnav (proposals, not decisions)

- **Shared body reader.** XI-20 lists no shared body reader, and MDB-WP-03 calls the shows body reader module code. This skeleton reads every body once, capped, counted while streaming and decoded as strict UTF-8, because the module interface hands modules `rawBody`. Modules still parse and validate it. If the skeleton reading the body is accepted, boundaries §6.2 should record it.
- **Token transport.** The specs say "optional per-launch token" without naming a header. This skeleton uses `Authorization: Bearer`, exempts `GET /api/health` so the app can detect the gateway, and returns reason `TOKEN_MISSING`.
- **`SCHEMA_VERSION_UNSUPPORTED` defaults to 500**, because MDB-T16 covers a stored document newer than the gateway. A module that rejects a client's version passes `status` explicitly.
- **Allowed origins.** The default is empty, which refuses every non-GET. The app's origin depends on OIB-Q2: a Vite proxy or a local origin with CORS.

## Credits

The module interface, registry, router, errors, config, health and the `gemini` interface were drafted by durhack-41. durhack-48 took the draft over and finished it, by orchestrator-approved handover, and added the server, the guard and the remaining tests.
