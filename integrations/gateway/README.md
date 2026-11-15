# Encore gateway (optional, offline skeleton)

This is the one shared optional gateway described in [boundaries §6.2](../../docs/design/OPTIONAL_INTEGRATION_BOUNDARIES.md#62-shared-gateway-skeleton-and-guard), with its first module, `gemini` ([GF-WP-12](../../docs/planning/gemini-integration-work-packages.md#gf-wp-12-gemini-module-of-the-optional-gateway-x-runlive--interface-only), [spec §10](../../docs/integrations/gemini-generated-formations.md#10-backend-gateway-gd-12), issue #218).

**Status: interface only. It makes no network call, has no SDK and no dependencies, and runs no server.** Encore does not use it. Deleting `integrations/` changes nothing for the app, the CLI or `bash scripts/check.sh`.

## What is here

| File | Purpose |
|---|---|
| `src/errors.ts` | The one error envelope, the shared code list and HTTP statuses, the `requestId` rule, `sanitise`, `redact` |
| `src/config.ts` | Configuration read only from the gateway's environment. Each module is off unless its enable flag and its key are both set. A disabled module's key is never read |
| `src/health.ts` | The body of `GET /api/health` |
| `src/gemini/types.ts` | The request and success bodies, the provider port and the scene-validator port |
| `src/gemini/request.ts` | Request validation (§10.1 limits) |
| `src/gemini/handler.ts` | `POST /api/generate-formation` as a pure function: maps every outcome (disabled, timeout, upstream error, blocked, truncated, malformed output, invalid scene, success) to spec §10.1's table |

## Offline is the default

`defaultGeminiDeps(config)` wires no provider and no validator. So in this build every valid request gets **503 `PROVIDER_UNAVAILABLE` with reason `MODULE_DISABLED`**, whatever the environment holds, and the module reports `disabled` in `/api/health`. The app uses the offline library (spec §10.5).

## Not here yet (later PRs)

- `src/server.ts` (`node:http`, bound to `127.0.0.1`) and `src/guard.ts` (Host allow-list, exact Origin, 415 for non-JSON, optional token, peer check): boundaries §6.2.
- The live provider (`@google/genai`, exact pin, 14-day release age, `npm ci --ignore-scripts`). It is added only after GF-D1 and credentials from Arnav. It implements `GeminiProvider` and is the only code that sees the key.
- The real `SceneValidator`: `validateScene`, `sceneHash` and the trial compile from GF-WP-01 / GF-WP-06 (`src/score/generated/`), imported by relative path (XI-2). `SceneSpec` in `types.ts` is a placeholder until then.
- The gateway rate bucket, logging, and the app client `src/app/live/geminiClient.ts` (needs the P2-T35 extension first).

## Configuration

See [`.env.example`](.env.example). Only the gateway process reads these variables; nothing is committed or bundled.

## Checks

These are not part of the root `check.sh`. Run them from this folder:

```bash
npm test             # node:test with type stripping (Node >= 22.12); no packages needed
npx --no-install tsc -p tsconfig.json   # typecheck, using the root repo's TypeScript
```

The root `eslint .` already lints these files.
