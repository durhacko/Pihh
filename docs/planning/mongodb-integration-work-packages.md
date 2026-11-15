# MongoDB Atlas show library: work packages

> **STATUS: PROPOSED — NOT IMPLEMENTED.** Nothing in this file exists in code. Do not open these issues or start coding until Arnav approves and decision MDB-D1 is made (see [Gating](#gating)).

Purpose: split William's Encore Show Library spec into packages `MDB-WP-01` to `MDB-WP-08`, plus the optional `MDB-WP-09`, each small enough for one person and their agent to finish in one PR. Status: proposal, issue #130, audit base `origin/main` 4c41f75. Source author: William Pimentel (`wpimento`), [source handoff](../handoffs/Encore_MongoDB_Atlas_Implementation_Spec.md) (cited below as "William §n"). Integrator: Arnav.

**Where things live.** These are defined in the canonical spec, [`../integrations/mongodb-atlas-show-library.md`](../integrations/mongodb-atlas-show-library.md): requirements `MDB-FR`/`MDB-NFR`, contract change proposals `MDB-CC`, conflict records `MCR-01…`, decisions `MDB-D1…D9`, risks `MDB-R`, review questions `MQ-*` and error codes. Tests `MDB-T*` are in [`../validation/mongodb-show-library-evaluation.md`](../validation/mongodb-show-library-evaluation.md). This file is canonical for `MDB-WP` titles and allowed files, and plans the work only. **Where this file and the canonical spec differ (a bound, an error code, a field name), the spec wins.** The orchestrator's cross-integration rulings XI-1…XI-15 are applied throughout and cited by number: shared gateway, imports, error envelope, hashing, size caps and one network decision (XI-1…XI-10); `requestId` (XI-11); one gateway skeleton and guard (XI-12); the pure validator's location (XI-13); app network code in `src/app/live/` (XI-14); composition file kinds and the MVP load (XI-15).

**Base rules, linked rather than restated:**
- the [contract](../design/contracts-and-algorithms.md): §2 types, §6 composition, §9 dissemination, §12 "not in the MVP";
- [requirements](../specification/requirements.md) **NFR-04**, the offline rule. `AGENTS.md:15` and `CURRENT_STATE.md` mislabel it NFR-10;
- [evaluation and tests](../validation/evaluation-and-tests.md);
- the boundary rules in [`AGENTS.md`](../../AGENTS.md) and [`tests/boundaries.test.ts`](../../tests/boundaries.test.ts);
- [`WORKFLOW.md`](../development/WORKFLOW.md).

Related drafts that are not yet on this branch:
- Gemini (provisional: depends on #117): the [spec](../integrations/gemini-generated-formations.md), its [work packages](gemini-integration-work-packages.md) and its [evaluation](../validation/gemini-formation-evaluation.md);
- Phase 2 (provisional: depends on #110): the [integration boundaries](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md) (X-IN, X-OUT, and **X-RUN/live and X-PERSIST (provisional, #110)** as amended by XI-4), the [roadmap](PHASE2_ROADMAP.md) and the [work packages](../development/PHASE2_WORK_PACKAGES.md);
- Tiger Data (stacked after this, #142): `docs/integrations/tiger-data-analytics.md` and `docs/planning/tiger-data-integration-work-packages.md` (#142), not yet linkable.

**Executed evidence: none.** Every test, check and demonstration below is a *planned check*. No MongoDB, gateway or Show Library code exists on `main` or on any pushed branch at 4c41f75, and no Atlas connection has been made.

## 1. Repo facts the packages rest on (verified at 4c41f75)

| Fact | Where | Consequence |
|---|---|---|
| **No backend.** The app is a static Vite build: no `server/`, and the only env var is `VITE_SIM_MODE` | `package.json`, `vite.config.ts` | William's "reuse existing backend" is impossible. One shared optional gateway, `integrations/gateway/` with modules `gemini`, `shows`, `tiger` (XI-1, MDB-D4, MCR-02) |
| **No Gemini or TigerData code exists**, despite "reported as completed" | orchestrator `git grep`, all `origin/*` | Save starts with manual Composer drafts (MDB-D7). Gemini drafts arrive with GF-WP-10 (MCR-01, MCR-13) |
| An injection is `{ type: 'inject'; recipe; at? }`. It needs a selected live drone (`origin` = that id), allows one `INJECT_SCORE` per tick, and text must match `/^[A-Z0-9 ]{1,20}$/i` | [`actions.ts`](../../src/app/actions.ts) 13, 155–160 | Loading a show means operator injections into one drone |
| `composeNext` returns version `{ issuedTick: tick, origin }` with two movements: the current one, and the new recipe at `tick + scoreLead` with a measured transition | [`compose.ts`](../../src/score/compose.ts) | One recipe per call. Stored `startTick`, `transitionTicks` or `version` would be stale (MD-2) |
| The controller composes from `authoredScore`. `schedule()` replaces it with each scheduled `INJECT_SCORE`'s score before that tick arrives | `actions.ts` 75, 96–98 | **Answers MD-3's open question.** Future `at` injections chain: step k+1 is built on step k's score (canonical §8.3) |
| A transition is ≥ `ceil(3 s / DT)` = 60 ticks; the default `scoreLead` is 60 | `score/timing.ts`, `contracts/params.ts` | With default params, `currentMovement(step k score, t_{k+1})` is always step k's movement. The planner still asserts it |
| Font: A–Z, 0–9 and space. `validateText` allows 1–20 characters (`TEXT_MAX`). `NAME_MAX` is 24 | [`font.ts`](../../src/score/font.ts), [`commands.ts`](../../src/app/ui/commands.ts) 115–116, 288–296 | Rules are derived from these, never copied. But `commands.ts` imports `../actions`, which imports `idsInSphere` and `randomIds` from `src/sim` (`actions.ts` 2), so the gateway may not import it (XI-2). `validateText` and `TEXT_MAX` therefore **move**, not copy, into the pure `src/app/compose/validate.ts`, with one re-export line left in `commands.ts` (XI-13, MDB-WP-02) |
| `validateDraft` sits in `Composer.ts`, which imports three.js and the DOM. It does not check that palette values are finite or in [0, 1] | [`Composer.ts`](../../src/app/ui/Composer.ts) 85 | A headless validator needs the pure `src/app/compose/validate.ts`: created by P2-WP-30a, or by MDB-WP-02 if 30a has not landed; the other extends it (XI-13). XI-2's gateway allow-list includes it |
| The panel loader ([`ui/index.ts`](../../src/app/ui/index.ts)) auto-mounts modules that export `createPanel({ host })`. The Composer is merged but unmounted until #113. **Changed since 4c41f75:** on `main` at c697f6c (#113 merged), nothing calls `createPanels` (it is still defined in `ui/index.ts`). Panels are mounted explicitly (`src/app/main.ts` 355), and `main.ts` creates the `Drafts` store (457) and connects the Composer (459) | `Composer.ts` 7–8; `main.ts` 65 at 4c41f75 | Self-registration no longer works. The Saved compositions panel gets **one flag-guarded mount line** in `main.ts` that passes it `Drafts`, `params` and the controls (canonical §12, MCR-14, MQ-1; shell-owner sign-off). There is no `Composer.ts` hook. WP-09's file-only panel needs its own mount line |
| The scripted demo sends timed injects with an explicit `at`, `LEAD_TICKS` (3 s = 60 ticks) early | [`DemoScript.ts`](../../src/app/ui/DemoScript.ts) 41 | Precedent for the MDB-WP-06 cue runner, whose dispatch lead R is the same 60 ticks (canonical §8.2 step 3) |
| Root `tsconfig` covers `src`, `tests` and `vite.config.ts`; vitest covers `tests/**`; `eslint .` ignores only `dist`, `node_modules` and `research` | root configs | `integrations/gateway/` is linted, but not typechecked or tested. P2-WP-30b adds the ignore, with owner sign-off (XI-1) |
| `canonicalJson` (sorted keys, throws on non-finite) lives in `src/cli/run.ts`, which also imports `node:crypto` | [`run.ts`](../../src/cli/run.ts) 27–36 | `contentHash` = sha256 of `canonicalJson(composition)` (XI-7). App and gateway reuse it only once it is extracted to a pure module: XI-7's one shared proposal (owner: Arnav) |
| `show save` and `show load` exist as `later` console commands | `commands.ts` 164–165 | Wanted by both GF-WP-11 and MDB-WP-09 (§5) |

## 2. Work packages

**Tests** cite `MDB-T` ranges; the evaluation doc assigns the individual IDs:

| Range | Covers |
|---|---|
| T01–T10 | Validation and serialisation |
| T11–T18 | API and repository, with mocked data access |
| T19–T24 | Idempotency, write protection, rate limits, size limits, error sanitisation, credential non-disclosure (grep of the built bundle) |
| T25–T29 | UI states |
| T30–T33 | Operator-pathway load, fresh versions, determinism with a fixture, isolation |
| T34–T36 | Offline: networking-off build and demo |
| T37–T40 | Live Atlas (separate test database) and the 10-step end-to-end acceptance |
| T41 | Offline export and import (MDB-FR-11, MDB-WP-09) |

**Lanes** follow [`TEAM_ROLES.md`](../development/TEAM_ROLES.md): A is brain, contracts and score; B is world, evidence, CLI and plumbing; C is experience. **Assignee for every package: TBD by Arnav.** No package is assigned to William or Haris (MDB-D5).

**Standard regressions**, required in every package that has code:
1. `bash scripts/check.sh` passes.
2. The isolation tests (`tests/boundaries.test.ts` T01 and `tests/isolation/*`) pass, unchanged.
3. The **networking-off build test** passes: `npm run build && npm run preview` with networking off requests nothing outside `localhost` (the NFR-04 acceptance).
4. `check.sh` passes with `integrations/` deleted (P2-T35, provisional: #110).
5. `stateHash` for S0–S5 seed 1 is unchanged.

### MDB-WP-01 Existing architecture verification

- **Purpose.** William's phase 1 ("Inspect") and §12's "report discrepancies". Re-verify §1 against `main` at start time, because #113, #121, #117 and #110 will have moved it. The output is a verification note, not code.
- **Dependencies.**
  - MDB-WPs: none.
  - Gemini, Phase 2 and Tiger (read only): P2-WP-30, GF-WP-01/02, 09, 10 and 12, and TIG-03 (#142).
  - MDB-D1: not needed.
- **Priority.** Essential: it gates every other package. Suggested P1.
- **Lane.** B, with lane A reviewing the score rows. Assignee: TBD by Arnav.
- **Allowed files.** None. The note goes in an issue comment.
- **Proposed interfaces.** None. The note must answer nine questions:
  1. Is there still no backend or `integrations/` folder?
  2. Is `authoredScore` still updated at schedule time?
  3. Has `validateDraft` moved, and have `validateText` and `TEXT_MAX` moved with it into `src/app/compose/validate.ts` (XI-13)?
  4. How does the #113 shell expose `Drafts`, and where would a mount line go?
  5. Has GF-CC-01 landed?
  6. What is the current state of `eslint.config.js` and `vite.config.ts`?
  7. Is there any Gemini or TigerData branch that the audit missed?
  8. Has any module work package (MDB-WP-03, GF-WP-12, TIG-03) been approved, so that it builds the shared gateway skeleton (XI-12)?
  9. Does `src/app/live/` exist, and who owns its skeleton and the P2-T35 extension (XI-14, OIB-Q3)?
- **Required approvals.** None.
- **Acceptance criteria.** Each §1 row is marked "still true" or "changed", with a file and line. Every change names the MDB-WPs it affects. Any new contradiction with William's spec goes to Arnav as a proposed MCR row and is never silently absorbed.
- **Tests (unit, integration, security).** None.
- **Regression checks.** None.
- **Rollback approach.** Not applicable.
- **Implementation risk.** Low. The real risk is skipping this package and building on a stale fact, such as a second gateway folder.
- **Expected demonstration evidence.** The note, with the SHA it was made at.

### MDB-WP-02 Storage model and validation

- **Purpose.** William §4 and §8.2 as one pure validator and one canonical form (MD-2, MD-4, MD-5). The stored object is a **reusable composition**, not a runtime `Score`. The field is renamed from `score` to `composition` (MCR-04). This package makes all three validation points possible with **one module** (XI-2):
  - (a) in the app, before save;
  - (b) in the service, on write;
  - (c) in the app and the service, on read.
- **Dependencies.**
  - MDB-WP-01.
  - **P2-WP-30a** (the offline half of P2-WP-30, provisional: #110), which creates `src/app/compose/validate.ts`: the DOM-free body of `validateDraft` plus the palette check. **XI-13:** whichever of P2-WP-30a and this package lands first creates the file, and the other extends it. If this package creates it, it does just that move (no behaviour change, re-exported from `Composer.ts`). Either way, `validateText` and `TEXT_MAX` move into it (§1), and `validate.ts` imports only `src/contracts`, `src/score` and `src/score/font`.
  - XI-7's extraction of `canonicalJson` to a pure module (owner: Arnav). This package never writes its own copy.
  - GF-WP-01/02 and GF-CC-01, only to accept `generated` recipes (schemaVersion 2, XI-8). Until then they are rejected.
  - MDB-D1: not needed.
- **Priority.** Essential. Suggested P1.
- **Lane.** A, with lane C reviewing the re-export. Assignee: TBD by Arnav.
- **Allowed files.**
  - `src/app/compose/validate.ts`: created here with the `Composer.ts` re-export line only if P2-WP-30a is absent; otherwise extended (XI-13).
  - The `validateText`/`TEXT_MAX` move into `validate.ts`, if P2-WP-30a has not made it, and one re-export line in `commands.ts` (`export { validateText, TEXT_MAX } from '../compose/validate'`), so console and Composer behaviour and imports are unchanged. Sign-off: the `commands.ts` owner.
  - The composition validator below, added **to `validate.ts`** (XI-13). It is not a second module, so XI-2's allow-list covers it with no further ruling. It adds no import beyond `src/contracts`, `src/score` and `src/score/font`.
  - `tests/persistence/composition.test.ts` and `tests/persistence/imports.test.ts` (the transitive import scan).
  - `tests/persistence/fixtures/*.json`: the shared corpus, which the gateway tests (MDB-WP-03) also read.
  - **No `integrations/` file.** The gateway's re-export and its corpus test belong to MDB-WP-03, which creates the gateway after MDB-D1.
- **Proposed interfaces.**

```ts
// src/app/compose/validate.ts (XI-13), added by this package — no DOM, no three.js, no node:*; importable by the gateway (XI-2)
export interface CompositionMovement { recipe: Recipe; holdTicks: number }   // no startTick, transitionTicks, version
export interface Composition { v: 1; movements: CompositionMovement[] }
export const COMPOSITION_LIMITS: { maxMovements: number; maxHoldTicks: number; maxTitleChars: number;
  maxPromptChars: number; maxBodyBytes: number };   // 16, 6000, 80, 2000, 65536: canonical §7.1, §9 (R1, R8, R9)
export interface CompositionIssue { path: string; rule: string; reason: string }  // = an XI-3 details[] entry
export type CompositionCheck =
  | { ok: true; composition: Composition; warnings: CompositionIssue[] }
  | { ok: false; errors: CompositionIssue[] };
/** Total over unknown, never throws. Shape-directed: descends only into known fields, never a generic walk.
 *  Fresh plain objects; rejects unknown keys, keys starting with '$' or containing '.', and
 *  __proto__/constructor/prototype. Text is upper-cased in the output so the hash is stable. */
export function validateComposition(input: unknown, params: Params): CompositionCheck;
// Canonical form: callers use canonicalJson(c) from the extracted helper (XI-7) directly; validate.ts defines no copy
export function compositionPreview(c: Composition): { movementCount: number; kinds: Recipe['kind'][] };
```

  **Rules** R1–R16 are canonical §9. They come only from the current contract:
  - `kind` is one of {text, sphere, helix}, with `generated` added only after GF-CC-01;
  - text passes `validateText`, which sits in the same file after the move above, never imported from `commands.ts`;
  - `palette` is absent or two RGB triples, each value finite and in [0, 1];
  - `holdTicks` is a safe integer in [0, max];
  - there are 1 to `maxMovements` movements;
  - each recipe passes a trial expansion, as `validateDraft` does, through the **strict** path. Today that is `expandRecipe`. For a `generated` recipe (after GF-CC-01) it is `expandRecipeStrict`, because the total `expandRecipe` returns a fallback sphere instead of throwing (Gemini ruling G2-1, Gemini spec §7.11; provisional: depends on #117). So a rejected generated recipe fails here, on save and on library load, and never passes as the fallback.

  **Bounded depth, strict decoding.** "Unknown keys at any depth" (R2) is enforced by shape, not by recursion over input. A valid composition nests at most 6 containers (composition → `movements` → movement → `recipe` → `palette` → RGB), 7 for the request body. Any nesting outside the known shape is rejected as `UNKNOWN_KEY` or `INVALID_FIELD` before `canonicalJson` (which recurses without a bound, `run.ts` 28–36) sees it, so a 64 KiB `[[[[…` body is a 400, never a `RangeError`. Bytes are decoded with `new TextDecoder('utf-8', { fatal: true })`; invalid UTF-8 is 400 `VALIDATION_FAILED` (reason `INVALID_JSON`), never silently replaced with U+FFFD. Whether `JSON.parse` itself is safe on such input is UNVERIFIED, so the body reader (WP-04) and the file importer (WP-09) also reject nesting deeper than 8 with a linear pre-parse scan.

  **Service side (XI-2, XI-13).** The gateway imports this same `validate.ts` by relative path, so service-side validation is **complete, trial expansion (R14) included**, on write and on read. There is no structural copy and no parity test. This supersedes Gemini CR-24's "cannot import `src/`" for this feature. It holds only because the module's transitive imports exclude `src/sim`, `src/app/actions` and `src/app/ui` (the `validateText` move above); the import scan enforces it.
- **Required approvals.** XI-2 and XI-13 recorded as decisions; the `commands.ts` owner for the re-export line. No contract change (MDB-CC-01 is deferred).
- **Acceptance criteria.**
  - Every fixture gets its expected verdict and codes.
  - The validator never throws on any JSON value.
  - Canonical form → parse → validate is the identity.
  - Fixtures carrying `version`, `startTick`, `transitionTicks`, `droneId` or `$set` are rejected.
  - The #112 Composer tests and the console tests are unchanged.
  - A root vitest test (the environment is already `node`, `vite.config.ts`) imports `validate.ts` alone and gives every fixture's verdict. A transitive import scan of it finds no `three`, DOM global, `node:*`, `src/sim`, `src/app/actions` or `src/app/ui` (extends MDB-T09). The gateway's own run of the corpus is MDB-WP-03's.
  - After GF-CC-01, a fixture with a rejected generated recipe is rejected (the strict path throws), and `generated` is accepted only in `schemaVersion` 2 (XI-8).
- **Unit tests.** MDB-T01–T10.
- **Integration tests.** None: this package is offline and gateway-free.
- **Security tests.** Prototype keys, `$` and `.` keys, oversized strings and arrays, and a 64 KiB deeply nested array (rejected, no throw) (T01–T10).
- **Regression checks.** The standard regressions. The module loads under the Node test environment, with no three.js or `document`.
- **Rollback approach.** Revert. Nothing imports the composition validator yet.
- **Implementation risk.** Medium:
  - the module must stay pure, or the gateway import breaks (an import scan covers it);
  - P2-WP-30a, P2-WP-05 and GF-WP-10 also edit `validateDraft`, and the `validateText` move touches `commands.ts`, which is shared with the console;
  - the v2 size budget for generated recipes, decided with GF-CC-01 (XI-8).
- **Expected demonstration evidence.** The test output with the fixture verdicts.

### MDB-WP-03 MongoDB repository and connection management

- **Purpose.** William's phase 3 ("Persist") and the §5 backend requirements: the official driver, one reused client, indexes, and data access behind an interface that tests can mock (William §10). It adds `shows` as an independently optional module of the one shared gateway (XI-1) at `integrations/gateway/`, beside `gemini` and `tiger`: each is enabled only by its own server-side configuration, and the absence or failure of one never disables another, the app, the simulator, the CLI or `report.ts`. No module creates its own server.
- **Dependencies.**
  - **MDB-D1** (= D3 = GF-D1 = TIG-D1, one decision, XI-9), under **X-RUN/live and X-PERSIST (provisional, #110)**.
  - MDB-D4.
  - MDB-WP-02.
  - **The shared gateway skeleton (XI-12):** one server, `guard.ts`, `errors.ts` (XI-3 envelope, `sanitise`, `redact`), `config.ts` and `GET /api/health`, with the dependency policy. Its rules are in the #110 boundaries §6.2 (provisional). It is built once, by whichever of MDB-WP-03, GF-WP-12 and TIG-03 (#142) is approved first. If that is this package, it builds the skeleton first, as its own commit; otherwise it waits for it. Either way it never redefines the guard or the errors.
  - P2-WP-30b (gated by P2-G6 and D3; provisional: #110) adds the eslint ignore (owner sign-off, XI-1).
- **Priority.** Essential (MVP). Suggested P1.
- **Lane.** B. Assignee: TBD by Arnav.
- **Allowed files.** Everything is under `integrations/gateway/`:
  - only if this package builds the skeleton: `package.json` (run with `tsx`), `package-lock.json`, `tsconfig.json` (resolves XI-2's relative `src/` imports), `README.md`, `.env.example` (variable names only), `src/server.ts`, `src/http/guard.ts`, `src/http/errors.ts`, `src/config.ts` and `src/health.ts`, exactly as XI-12 defines them;
  - the shows section of `src/config.ts` (reads only `MONGODB_URI` and `MONGODB_DB`; XI-12: each module reads only its own secrets) and `src/db/mongo.ts`;
  - `src/shows/types.ts`, `repository.ts`, `mongoRepository.ts`, `memoryRepository.ts` and `indexes.ts` (the lazy index confirmation);
  - `scripts/shows-setup.ts` (proposed name): the admin set-up script that creates the indexes and the optional `$jsonSchema` validator, run once by hand with the admin user (canonical §11);
  - `src/shows/validate.ts`, a thin re-export of `src/app/compose/validate.ts` by relative path (here, not in WP-02, so the gateway exists only after MDB-D1);
  - `test/repository.test.ts`, `test/imports.test.ts` (the XI-2 allow-list scan) and `test/validate.test.ts` (the WP-02 corpus through the gateway's import, with the app's verdicts);
  - `test/mongoRepository.live.test.ts`, skipped unless `MONGODB_TEST_URI` is set.
- **Proposed interfaces.**

```ts
// integrations/gateway/src/shows/types.ts — imports Composition from src/app/compose/validate.ts (XI-2, XI-13)
export interface SavedShowDoc {
  _id: ObjectId; schemaVersion: 1; title: string; prompt?: string;   // prompt only with explicit opt-in (MDB-D2)
  composition: Composition; contentHash: string;                      // sha256(canonicalJson(composition)), server-computed (XI-7)
  requestHash: string;                                                // sha256 of the normalised request: the idempotency fingerprint (canonical §7.3)
  source: 'gemini' | 'manual'; generator?: { model: string; integrationVersion: string; sceneHashes?: string[] };
  preview: { movementCount: number; kinds: string[] }; operationId: string; createdAt: Date; updatedAt: Date;
}
// ShowSummary, SavedShow: canonical §10.1
export type NewSavedShow = Omit<SavedShowDoc, '_id' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;
export type InsertOutcome = { kind: 'created'; id: string }
  | { kind: 'duplicate'; id: string; requestHash: string }           // E11000 on operationId, then findOne
  | { kind: 'outcome-unknown' };                                      // E11000, then findOne returned null → 503 OUTCOME_UNKNOWN
export interface ShowsRepository {                                    // mocked in unit tests
  insert(show: NewSavedShow, now: Date): Promise<InsertOutcome>;      // never called until confirmIndexes() is 'ok'
  list(page: { limit: number; after?: { createdAt: Date; id: string } }):
    Promise<{ items: ShowSummary[]; next: { createdAt: Date; id: string } | null }>;
  get(id: string): Promise<SavedShowDoc | null>;                       // id already checked as 24 hex
  ping(): Promise<'up' | 'down'>;
}
export function getDb(c: { uri: string; dbName: string; serverSelectionTimeoutMS: number }): Promise<Db>;
  // one MongoClient for the process lifetime; no eager connect(); await old.close() before any replacement (canonical §10.6)
export function confirmIndexes(db: Db): Promise<'ok' | 'missing'>;
  // listIndexes on the first successful connection; memoised; a failure is not cached (canonical §11)
// scripts/shows-setup.ts (admin user only): { createdAt: -1, _id: -1 }, unique { operationId: 1 }, optional $jsonSchema
```

  **Driver facts** are canonical §10.9 (VERIFIED and UNVERIFIED rows, 2026-11-15). The duplicate-key code 11000 is VERIFIED. Detect it as `err instanceof MongoServerError && err.code === 11000`, and when the error carries `keyPattern`, it must name `operationId`; anything else is 500 `INTERNAL` (canonical §10.5). Still to check here: the driver option names for `maxTimeMS` and `timeoutMS` on `insertOne`, and driver support for Node 22.12+ (check before pinning). The pin follows the skeleton's dependency policy (XI-12): an exact version, a 14-day minimum release age, `npm ci --ignore-scripts` and `npm audit signatures`.

  **Indexes.** The runtime user never creates them. The set-up script does, once (canonical §11). On the first successful connection the module runs `listIndexes` and confirms a **unique** `{ operationId: 1 }`. Until that resolves, writes fail closed with 503 `DATABASE_UNAVAILABLE` (reason `INDEX_MISSING`) and `insert` is never called; reads may proceed (MDB-R33). Error 85 `IndexOptionsConflict` and 86 `IndexKeySpecsConflict` are configuration errors: logged, module left disabled.

  **Optional `$jsonSchema`** (MD-6), applied by the set-up script, mirrors the structural rules as defence in depth (canonical §9). It lists `_id: { bsonType: 'objectId' }`, uses `['int', 'long']` for `schemaVersion` and `holdTicks`, and `'number'` in [0, 1] for palette channels. A rejection (121) means drift: 500 `INTERNAL` with reason `VALIDATOR_DRIFT`.
- **Required approvals.** MDB-D1, MDB-D4, and the eslint ignore (through P2-WP-30b or build-config owner sign-off). **Root `package.json`, CI and `eslint.config.js` changes need owner sign-off** (XI-1); this package makes none to the first two. The root manifest is William's, and he has paused.
- **Acceptance criteria.**
  - The gateway imports from `src/` only XI-2's allow-list (never `src/app` outside `src/app/compose/validate.ts`, `src/agent`, `src/sim`, `src/observer` or `src/cli`).
  - The gateway, importing the module under Node, gives the app's verdict on the whole WP-02 corpus.
  - The memory and Mongo repositories pass one contract suite.
  - A repeated `operationId` gives `duplicate` with the stored `requestHash`, and no second document. A null read after E11000 gives `outcome-unknown`.
  - Keyset paging is newest first, with `_id` as the tie-break.
  - No client is built at start; the factory is called once across 100 requests, and concurrent first calls create one client (MDB-T18).
  - Until `listIndexes` confirms the unique index, `insert` is never called. A failed confirmation is retried on the next request (MDB-T18, T37).
  - The `$jsonSchema` accepts every accepted fixture, int32 and double palette values included (MDB-T09).
  - An unreachable URI fails within the timeout as a typed `DatabaseUnavailable`, never as a raw driver error.
  - No telemetry, frame, `RunRecord` or experiment-catalogue field exists in the types (MD-13, XI-6).
- **Unit tests.** MDB-T14 and T16–T18.
- **Integration tests.** MDB-T37–T38: a live read-after-write against a **separate test database**, run by hand.
- **Security tests.** The URI is never logged or echoed (T19–T24). Two Atlas users, checked by MDB-T37 and recorded in the README (canonical §21):
  - **runtime:** a custom role with `find`, `insert` and `listIndexes` on `encore.saved_shows` only, never `readWrite` (collection scoping is UNVERIFIED; the fallback, `readWrite` on `encore`, is recorded as a risk);
  - **admin:** runs the set-up script, and is never in the gateway's `.env`.
- **Regression checks.** The standard regressions. The root `npm ci` installs no MongoDB package.
- **Rollback approach.** Delete `src/shows`, `src/db` and the set-up script. Delete the skeleton too only if this package built it and no other module uses it. Nothing in `src/` depends on them.
- **Implementation risk.** Medium:
  - a second skeleton or a second module layout: the Tiger plan (#142) places its module at `integrations/gateway/tiger/`, this package at `src/shows/` (one layout, chosen with the skeleton, MDB-D4);
  - pinning the driver and Node versions;
  - Atlas network access from the venue.
- **Expected demonstration evidence.** A live read-after-write log from the test database. None exists until it is run.

### MDB-WP-04 Saved Shows API

- **Purpose.** William's four routes and status table (§5), plus MD-7 idempotency and MD-8's 409, 413 and 415, in the gateway's one error envelope (XI-3). William's **400** is kept for all invalid input, rather than 422, because `details[].reason` already separates malformed JSON from a rule violation and there is one client. **Not here:** the bind, Host, Origin, content-type and CORS rules (403, 415) are the shared gateway skeleton's guard (XI-12). The rate limiter (429) is not part of the guard: XI-12 and the #110 boundaries §6.2 guard table list none. WP-07 builds the shows limiter, sets its values and tests the guard on these routes. This package is not run against real Atlas until WP-07 merges (runbook, Atlas users).
- **Dependencies.**
  - MDB-WP-03.
  - MDB-D1.
  - MDB-D2, which decides whether `prompt` is accepted.
  - The shared gateway skeleton (XI-12): the routes register with its `server.ts` (`node:http`, no framework; William: do not add Express "before inspecting current infrastructure"), and every error uses its `errors.ts`.
- **Priority.** Essential (MVP). Suggested P1.
- **Lane.** B. Assignee: TBD by Arnav.
- **Allowed files.** Under `integrations/gateway/`:
  - one registration line in `src/server.ts` and the shows entry in `src/health.ts` (`modules.shows`);
  - `src/http/body.ts` (byte cap, fatal UTF-8 decode, pre-parse depth scan), only if the skeleton has no body reader; otherwise this package only sets the shows cap;
  - `src/shows/routes.ts`, `hash.ts` (`contentHash` and `requestHash`: sha256 via `node:crypto` over the shared `canonicalJson`, XI-7) and `errorMap.ts` (shows reasons, and driver errors 11000, 121, 50, server selection and the deadline mapped onto the skeleton's codes);
  - `test/routes.test.ts`, `test/idempotency.test.ts` and `test/deadline.test.ts`.
  - **Not** `server.ts` beyond the line, `errors.ts` or `guard.ts`: the skeleton's (XI-12).
- **Proposed interfaces.**

```ts
// POST /api/shows   Content-Type: application/json; Idempotency-Key: <uuid v4> (body operationId as fallback)
//   body SaveShowRequest → 201 { show: SavedShow; idempotentReplay: false } + Location   (types: canonical §10.1–10.2)
//   200 + idempotentReplay: true on same key and same requestHash · 409 CONFLICT (IDEMPOTENCY_CONFLICT) on same key, other requestHash
// GET /api/shows?limit=20&cursor=<opaque> → 200 { items: ShowSummary[]; nextCursor: string | null }  (limit ≤ 50)
// GET /api/shows/:id → 200 { show: SavedShow }
// GET /api/health    → the skeleton's route; this module adds modules.shows { enabled; db: 'up' | 'down' | 'disabled' } (canonical §10.4)
// ErrorBody, the shared code list, sanitise and redact: the shared gateway skeleton's errors.ts (XI-12, XI-3). Not redefined here.
export type ShowsReason = /* canonical §10.1 ReasonCode */ string;
export function createShowsHandler(repo: ShowsRepository, clock: () => Date, limits: ShowLimits):
  (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;   // false = not a shows route
export function mapShowsError(error: unknown): { status: number; code: string; reason?: ShowsReason };  // errorMap.ts; then the skeleton's sanitise
```

  Shows-specific causes (malformed JSON, id, cursor or idempotency key; idempotency conflict; stored show invalid; module disabled; index missing; outcome unknown; validator drift; the validator's reasons) go in `details[].reason`, never in `code`. The canonical spec §10.1 fixes the reason strings.

  **`requestId` (XI-11).** Optional and client-generated, matching `^[A-Za-z0-9._:-]{1,64}$`. A value that does not match is dropped, not echoed, and the request proceeds. The skeleton logs its own server id.

  **Why the `Idempotency-Key` header.** It keeps the body equal to the content being hashed, and it is a common HTTP API convention. The standing of the IETF draft is UNVERIFIED and nothing here relies on it. If a header and a body key disagree, the request gets a 400. **The comparison is `requestHash`, not `contentHash`** (canonical §7.3, §10.5): the same key and composition with a new title, a ticked "Store prompt" or another `generator` is a 409.

  **Write path** (the skeleton's guard has already answered 403 and 415, and WP-07's limiter 429):
  1. Read the body with a byte cap of 64 KiB (schemaVersion 1, XI-8) before parsing (413).
  2. Decode as strict UTF-8, scan the nesting depth, then parse (400 `INVALID_JSON`; WP-02's "bounded depth, strict decoding").
  3. Run the shared validator, trial expansion through the strict path included (400 `VALIDATION_FAILED`, XI-2, G2-1).
  4. Build the document field by field and never spread client input.
  5. Compute `contentHash` and `requestHash` after normalisation. If the unique index is not yet confirmed, return 503 `INDEX_MISSING` without calling `insert`.
  6. `insert`, with `maxTimeMS: 2000`. A 121 rejection is 500 `INTERNAL` (`VALIDATOR_DRIFT`).
  7. On `duplicate`, compare `requestHash`: 200 for a replay, 409 for a conflict. On `outcome-unknown`, 503 (`OUTCOME_UNKNOWN`), retryable with the same key.

  **Handler deadline: 5 s** (canonical §10.6, a planning value). Every repository call is wrapped in it. A hit is 503 `DATABASE_UNAVAILABLE`; for POST the reason is `OUTCOME_UNKNOWN`, and a retry with the same key gives 201 or a 200 replay. It is tested with a fake clock and a repository that never resolves.

  **Read path:**
  - The id must match `^[0-9a-f]{24}$` before any query (400 `INVALID_ID`).
  - The cursor is re-typed before use: it decodes to exactly `[ms, hex]`, a safe non-negative integer and 24 lower-case hex. The filter is built only from `new Date(ms)` and `new ObjectId(hex)`. Anything else, operator objects included, is 400 `INVALID_CURSOR` before any query (canonical §11).
  - Every query sets `maxTimeMS: 2000`.
  - The stored composition is re-validated with the same module. A corrupt document returns 500 `INTERNAL` (`STORED_SHOW_INVALID`) and is logged without content; a newer `schemaVersion` returns 500 `SCHEMA_VERSION_UNSUPPORTED`.
  - List returns only William's metadata projection. Every projected field is validated per item; an item that fails is returned as `loadable: false, problem: 'invalid'` with the fixed title "Invalid saved show" and no stored value (canonical §10.3).
- **Required approvals.** MDB-D1 and MDB-D2. MDB-D3 only for anything beyond `127.0.0.1`, which is out of MVP.
- **Acceptance criteria.**
  - Every status in William's table, plus 409, 413 and 415 (the guard's 415 through these routes), has a test. 403 and 429 are tested in WP-07.
  - Every non-2xx body is the XI-3 envelope with a shared-list code; no driver text, stack trace or URI appears in any response.
  - Same key, same composition, new title gives 409; same key and same request gives 200 with the original id (MDB-T19).
  - The deadline gives 503 within 5 s on a fake clock (MDB-T17).
  - A tampered cursor or an operator object gives 400 `INVALID_CURSOR` before any query (MDB-T14, T22).
  - A non-matching `requestId` is dropped and not echoed (MDB-T23).
  - List returns no `composition` and no `prompt`; a bad projected field gives the fixed placeholder.
  - `limit` is bounded.
  - The shows entry in health works with the database down or `disabled`.
- **Unit tests.** MDB-T11–T18.
- **Integration tests.** MDB-T38–T39, over HTTP against the test database.
- **Security tests.** MDB-T19, T22 and T23: duplicate retry, conflict, sanitised errors, and `$`-key injection; with T13's 413, plus a 64 KiB nested array and invalid UTF-8 bytes (both 400, never 500).
- **Regression checks.** The standard regressions, plus the gateway's own `npm test`.
- **Rollback approach.** Unregister the shows routes. Health then reports `disabled` and the app hides the library.
- **Implementation risk.** Medium. Hand-rolled body handling (chunking, caps) needs its own tests, and the skeleton (XI-12) is shared with GF-WP-12 and the Tiger module. If the package is still too large for one PR, the keyset cursor is the piece to split off (§6, item 4).
- **Expected demonstration evidence.** A status-code test report. Optionally a `curl` transcript against `127.0.0.1`.

### MDB-WP-05 Frontend Show Library

- **Purpose.** William §7: a **Save composition** action in a **Saved compositions** panel (labels: MDB-D9, which keeps clear of the shell's "Show"), sourced from the Composer's drafts rather than a parallel flow (MD-12; the Gemini spec's CR-16 did the same).
- **Dependencies.**
  - MDB-WP-02, MDB-WP-06 (Load as drafts), and MDB-WP-04 for the live client. The panel is built against a fake client first.
  - **Base #113** (merged), which creates the `Drafts` store in `main.ts` (§1).
  - **XI-14:** app network code lives only in `src/app/live/`, behind a build-time flag. Before any code merges, P2-T35's scan is extended to allow network APIs only there (#110 boundaries §6.2, provisional). Who owns the folder skeleton and that extension is open (OIB-Q3).
  - GF-WP-10, for saving a generated draft. Until then only `source: 'manual'` exists (MDB-D7).
  - MDB-D1, MDB-D2 and MDB-D9.
- **Priority.** Essential (MVP). Suggested P1.
- **Lane.** C. Assignee: TBD by Arnav.
- **Allowed files.**
  - `src/app/live/shows.ts` (new): the client (canonical §12, MCR-17).
  - `src/app/live/SavedCompositions.ts` (new): the panel (Save composition, list, retrieve, Load as drafts).
  - **One flag-guarded mount line** in `src/app/main.ts`: `import.meta.env.VITE_SHOW_LIBRARY === '1'` guards the mount call, constant-folded, and passes the panel `Drafts`, `params` and the controls (canonical §12, MCR-14, MQ-1; shell-owner sign-off). No `Composer.ts` edit.
  - `tests/persistence/showsClient.test.ts`.
  - `tests/persistence/savedCompositions.test.ts`, using `tests/app/ui/fakeDom.ts`.
  - **Not** `main.ts` beyond that line, the #113 shell, `Composer.ts`, `styles.css` or `vite.config.ts`. WP-09's file-only panel is a separate file.
- **Proposed interfaces.**

```ts
// src/app/live/shows.ts — under src/, only src/app/live/ uses a network API (XI-14); same-origin /api/* or the configured 127.0.0.1 origin
export type ShowsAvailability = 'off' | 'probing' | 'unavailable' | 'disabled' | 'down' | 'up';  // canonical §12; off = flag unset: not in the bundle
// probing (state 2) is held by the panel while a probe is in flight; probeShows never resolves to it
export type ApiResult<T> = { ok: true; value: T }
  | { ok: false; code: string /* canonical §10.1 ErrorCode */ | 'NETWORK'; message: string; retryable: boolean };  // retryable: client-derived, by status
export interface ClientOptions { fetch?: typeof fetch; timeoutMs?: number }
export function probeShows(o?: ClientOptions): Promise<ShowsAvailability>;
export function newOperationId(): string;                                         // crypto.randomUUID()
export function saveShow(input: Omit<SaveShowRequest, 'operationId'>, operationId: string, o?: ClientOptions):
  Promise<ApiResult<{ show: SavedShow; idempotentReplay: boolean }>>;
export function listShows(cursor?: string, limit?: number, o?: ClientOptions):
  Promise<ApiResult<{ items: ShowSummary[]; nextCursor: string | null }>>;
export function getShow(id: string, o?: ClientOptions): Promise<ApiResult<{ show: SavedShow }>>;
// src/app/live/SavedCompositions.ts — talks to the simulation only via encore:control / encore:control-status, and the Drafts store for Load as drafts
export function createPanel(o: { host: HTMLElement; drafts: Drafts; params: Params; controls: ReturnType<typeof bindControls> }): void;
```

  **UI states** and their messages are canonical §12: ten states, with sub-states 6a/6b, 9a and 10a–c, from a model of four independent dimensions (availability, save, selection, load). Each input has exactly one value per dimension.

  **Health probes** (canonical §12, the one rule): one `/api/health` probe on mount, in flag-on builds only, plus one per user action (opening the panel, **Check again**, Save, Retry). Probes are at least 2 s apart, doubling to 30 s, and never run as a background loop.

  **Save.** Enabled only when every chosen draft passes `validateDraft`, or the Gemini tab's validator after GF-CC-01 (GF-WP-10). With the library unavailable it is shown disabled with state 7's reason. The form follows canonical §12: a title, the current draft by default, optionally more validated drafts, each with `holdTicks`, and "Store prompt" unticked (MDB-D2). Retry (6a, retryable failures only) resends the same key and body. Any edit discards the pending request, and the next Save makes a new key. A definitive failure (6b: 400, 409, 413, 415, 401, 403) offers no Retry.

  **Rendering.** Stored strings reach the DOM only as `h()` text children, `textContent`, or `setAttribute` on a non-URL attribute. Banned in these files: any `innerHTML` or `outerHTML` assignment, the `html:` key of `h()` (it assigns `innerHTML`, [`dom.ts`](../../src/app/ui/dom.ts) 18), `esc(` followed by markup, `insertAdjacentHTML`, `document.write` and `srcdoc` (MDB-T22).
- **Required approvals.** MDB-D1, MDB-D2, MDB-D9, the shell owner (the mount line) and MDB-D5.
- **Acceptance criteria.**
  - Every state of canonical §12 is reachable with a fake client, with one value per dimension per input.
  - A failed or timed-out save keeps the draft. Retry sends the same key and body; an edit discards the pending request.
  - With the library flag off (the default), the panel is not in the bundle, nothing renders, the app makes **zero** requests (XI-9), and `dist/` contains no `/api/shows` or `/api/health` string (MDB-T24, T35).
  - With the flag on and no gateway: one probe on mount, then only on user actions, with backoff; state 7; **Check again** picks up a gateway started later.
  - Every response is re-validated before Load is offered, list items per field.
  - No HTML is built from stored strings: the static scan of the banned sinks passes.
- **Unit tests.** MDB-T25–T29. The client's parsing and timeouts are covered by T11–T18.
- **Integration tests.** Panel → client → gateway on the memory repository (T37–T40 group).
- **Security tests.** A title, prompt or `generator.model` containing `<img src=x onerror=…>` renders as text, with zero `img` and `script` elements in the panel. No credentials and no `VITE_*` secrets in the client (T19–T24).
- **Regression checks.** The standard regressions, plus T34–T36 with the gateway absent.
- **Rollback approach.** Remove the mount line and the two `src/app/live/` files; the file-only panel (WP-09) stays.
- **Implementation risk.** Medium:
  - the mount line needs the shell owner's sign-off (MQ-1);
  - it must not steal focus from the Composer's never-rebuilt text fields;
  - it adds the first network code under `src/app`, confined to `src/app/live/`. Lint bans `fetch` only in core, but this is still new, and it is why MDB-D1 is required. The app may call the gateway while the simulation runs, but never inside the tick loop or a decision path (XI-5).
- **Expected demonstration evidence.** Once executed: a recording of save → refresh → list on the test database, with no URI or Atlas console visible.

### MDB-WP-06 Operator pathway integration

- **Purpose.** William §3 step 6 and the §6 loading flow, which is his phase 4 ("Integrate"). A stored composition goes through the **existing injection pathway** (canonical §8.2, §13), and the controller assigns each runtime `ScoreVersion` (MD-3, MD-14). It never sets drone targets and never bypasses radio: nothing from the gateway reaches a drone except via an operator `INJECT_SCORE` (I7, XI-5). Two parts (XI-15, MDB-D6):
  - **MVP: Load as drafts** (X-IN step 7). Each validated movement becomes one Composer draft named `<title> i/k`, with `holdTicks` shown as advice. The operator injects each one as today, so every injection is an operator action (canonical §8.2).
  - **Follow-up, opt-in: the cue runner**, built only after MCR-21 is approved (MQ-3). It is planned below so that the timing is fixed now.
- **Dependencies.**
  - MDB-WP-02.
  - Base #113 owns `actions.ts` and `commands.ts`. This package changes neither.
  - **MDB-D1 is not required**: loading works from a fixture or a file.
  - MDB-D6: Load as drafts for the MVP; the just-in-time runner (over pre-scheduling) only after MCR-21.
- **Priority.** Load as drafts: Essential (MVP), suggested P1. The runner: Optional, suggested P3.
- **Lane.** C, with lane A reviewing the timing. Assignee: TBD by Arnav.
- **Allowed files.**
  - `src/app/compose/showLoad.ts` (new, pure): `draftsFromComposition` now; the runner only after MCR-21.
  - `tests/persistence/showLoad.test.ts`.
  - `tests/persistence/showDeterminism.test.ts`.
  - `tests/persistence/fixtures/*.json`.
- **Proposed interfaces.**

```ts
// src/app/compose/showLoad.ts — no DOM; ControlPort adapts the encore:control / encore:control-status events
export function draftsFromComposition(title: string, c: Composition): { name: string; recipe: Recipe; holdTicks: number }[];
  // MVP: names "<title> i/k"; the panel turns each into a draft (draftFromRecipe, Composer.ts 78) in the Drafts store; zero intents
// Follow-up (after MCR-21):
export interface ShowLoadPlan { droneId: number; steps: { recipe: Recipe; holdTicks: number }[] }
export function planShowLoad(c: Composition, droneId: number): ShowLoadPlan;
/** t_{i+1} = t_i + max(L, T_i + h_i), L = params.scoreLead (canonical §8.2 step 6). */
export function nextStepTick(tickI: number, transitionTicksI: number, holdTicksI: number, scoreLead: number): number;
export interface ControlPort { dispatch(intent: ControlIntent): ControlResult; status(): ControlStatus }
export interface CueRunner {
  readonly state: 'running' | 'paused' | 'done' | 'stopped' | 'failed'; readonly problem: string | null;
  readonly scheduled: { step: number; tick: number; version: { issuedTick: number; origin: number } }[];
  poll(): void;   // on every control status: dispatches the next step R ticks early with an explicit `at`
  resume(): void; stop(): void;
}
export function loadComposition(plan: ShowLoadPlan, port: ControlPort, dispatchLead?: number): CueRunner;  // R = 60 = LEAD_TICKS (canonical §8.2 step 3)
```

  **How the cue runner works** (follow-up; canonical §8.2 is authoritative; this is the plan):
  - **Preconditions** (canonical §8.2 step 1): the controls report `composition`, a live drone is selected, no other load runs, and the scripted demo is not running ("Stop the scripted demo first."; its inject beat would collide with the one-injection-per-tick rule). Starting the demo stops an active runner.
  - **Step 1** goes at the operator's chosen tick, or with no `at` so it lands on the next tick.
  - **Step i+1** is sent once `status.tick ≥ t_{i+1} − R`, as one `inject` with `at = t_{i+1}`. R = 60 ticks covers the 200 ms status cadence at 4× plus a frame's steps, and keeps at most one future step scheduled. **The runner never sends `select`**: unlike the DemoScript, it would take over the operator's selection and inspector mid-show. If late, it goes without `at` and the load is marked off-schedule. `T_i` is read from the returned event, `result.event.score.movements[1].transitionTicks`, after the event is checked (canonical §8.2 step 5).
  - Each step is its own `composeNext`, with a **fresh** version `{ t_i, droneId }`. Because composition chains through `authoredScore`, step i+1 starts with step i's movement; the `max` keeps movement i from vanishing.
  - **Selection check before every dispatch:** `status.selectedId === plan.droneId && status.selectedAlive`. Otherwise the runner pauses with the fixed message of canonical §8.2 step 7: "Paused: drone <id> is no longer selected or alive." On current `main`, an inject also fails with `STATIC_SELECTION_REFUSAL` when the selection was made in the static pane (`actions.ts` 45, 105–106 and 194 at c697f6c; `ControlStatus` does not report the pane). The runner treats that result as the same pause, not as a failed intent. **Resume** continues into the live Encore drone selected at that moment, and the panel names it. It never retargets silently. An uplink into a drone that dies after dispatch is flagged as possibly undelivered.
  - **Reset, seed change, a foreign `INJECT_SCORE` or a failed intent** stop it.
  - **Stop** cancels every step not yet dispatched. The one step already dispatched (at most one, up to R ticks ahead) cannot be un-scheduled and still flies; the panel says so (state 10c).

  **Late or missed adoption** follows LWW (contract §9). A drone that misses step k adopts step k+1, which carries step k's movement first. A drone cut off past `t_{k+1} + scoreLead` joins movement k+1 directly. Adoption is reported only from observer `MetricsSample.versions`.

  **Why not schedule every step at once** is canonical §8.3 (no un-schedule, a fixed drone, interleaving; MDB-D6). The single-call alternative, `composeShow` in `src/score`, is **MDB-CC-01: deferred. PROPOSED CONTRACT CHANGE — REQUIRES ARNAV APPROVAL.** No package depends on it.

  **X-IN.** A loaded show is a candidate composition that passes X-IN validation before any operator injection (XI-4). **Load as drafts** is X-IN step 7 and conforms. The runner schedules *k* injections after one confirmation ("Schedule *k* injections into drone D?", state 9a), against X-IN's "never schedules injections by itself" (MCR-21). It is built only if Arnav and the #110 owner amend that rule. The format gap is MCR-20 (§6, item 2).
- **Required approvals.** None for Load as drafts. The runner: MCR-21 approved by Arnav with the #110 owner, then MDB-D6.
- **Acceptance criteria.**
  - **Load as drafts:** a three-movement fixture adds three drafts in order, named `<title> 1/3` to `<title> 3/3`, and dispatches **zero** intents until the operator injects (MDB-FR-04). A movement that fails validation, a rejected generated recipe included (strict path, G2-1), never becomes a draft.
  - **Runner (follow-up):** on headless worlds with a three-movement fixture, each step is exactly one `INJECT_SCORE` into the chosen drone, at the planned tick, with a strictly newer version.
  - The measured holds equal `holdTicks`.
  - Every step goes through `controller.handle`.
  - The runner dispatches no `select`. A lost, unselected or static-pane-selected drone pauses it visibly (the static-pane case belongs in MDB-T30's setup); reset or a foreign injection stops it.
  - The runner does not start while the scripted demo runs, and starting the demo stops it (MDB-T30).
  - A headless replay of the event log gives the same `stateHash`.
  - The fixture injected directly and the same fixture injected through `loadComposition` give the same `stateHash` (MD-14).
- **Unit tests.** MDB-T30–T31.
- **Integration tests.** MDB-T32: determinism from a fixture, without Atlas.
- **Security tests.** An unknown recipe kind never reaches `dispatch` or a draft. Unvalidated, it would crash `expandRecipe` in both worlds. A rejected generated recipe fails the strict path (G2-1) and never reaches either.
- **Regression checks.** The standard regressions, MDB-T33 (isolation unchanged), and `tests/app/demo.test.ts`.
- **Rollback approach.** Revert. Only WP-05 and WP-09 import the module.
- **Implementation risk.** Load as drafts: Low. The runner: Medium-high:
  - an off-by-`scoreLead` timing bug;
  - a manual inject during a show, which is legal under LWW but surprising, so the panel says so;
  - #113 changing `ControlResult` or the status event.
- **Expected demonstration evidence.** Load as drafts: the drafts list after a load, with zero intents in the log. The runner: a headless log of each step's tick, version and measured hold.

### MDB-WP-07 Fault handling and security

- **Purpose.** William's phase 6 ("Harden"): the §8.3 security list and the §9 failure scenarios A–F, plus "gateway not running" and "refresh" (MD-10, MD-11). It builds the shows module's rate limiter, sets its values, and tests the shared gateway skeleton's guard (XI-12) on the shows routes; it does not write the guard. It also documents the operator's local runbook.
- **Dependencies.**
  - MDB-WP-04, 05 and 06.
  - The shared gateway skeleton (XI-12).
  - MDB-D1.
  - MDB-D3, only for a public deployment, which is out of MVP. That case needs server-side authorisation, such as a server-held operator credential behind a server-issued HttpOnly session, plus stricter rate limits (MD-9).
- **Priority.** Essential before any demo with real Atlas. Suggested P1.
- **Lane.** B for the service and C for the UI states. Assignee: TBD by Arnav.
- **Allowed files.**
  - Under `integrations/gateway/`: `src/shows/rateLimit.ts`, the shows rate limiter (see below), and its one call in `src/shows/routes.ts`, after the guard and before the body is read; the shows rate-limit values in `src/config.ts` (writes 10 per minute with a burst of 3; reads 120 per minute; planning values, canonical §10.7), `README.md` (the runbook: Atlas users, venue network access, `.env` handling), `test/faults.test.ts`, `test/security.test.ts`, and `test/bundle-secrets.test.ts`, which scans the root `dist/` after a build.
  - `tests/persistence/faults.test.ts`.
  - **Not** `guard.ts` or `errors.ts`: the skeleton's (XI-12).
- **Proposed interfaces.** Only the rate limiter is new. The guard and its configuration are the shared gateway skeleton's (XI-12): bind `127.0.0.1` only, Host allow-list (`127.0.0.1:<port>`, `localhost:<port>`, plus the dev proxy if used), exact Origin on every non-GET (missing or `null` → 403 `FORBIDDEN`), 415 for non-JSON bodies, non-loopback peers refused, an optional per-launch token, and no CORS headers unless OIB-Q2 decides for CORS. The shows module supplies its rate limiter, its rate values and its routes.

  **Rate limiter.** XI-12 and the #110 boundaries §6.2 guard table list no rate limiter, so the shows module builds its own in `rateLimit.ts`. It is a token bucket per process (canonical §10.7), with one bucket for writes and one for reads, a fixed-size state and an injected clock. A request over the limit gets `429` `RATE_LIMITED` with `Retry-After`, through the skeleton's `errors.ts`, and the repository is never called (MDB-T21). If Arnav later adds a limiter to the skeleton, this file moves there and the shows module keeps only its values.

  **Fault matrix.** Each row is a planned test:

  | Scenario (William) | Expected |
  |---|---|
  | A. Atlas down during save | 503. State 6a with a state 7 badge; the draft and request are kept, Retry uses the same key and body, and the simulation is untouched |
  | B. Corrupt document | Rejected on read by both sides. Never injected |
  | C. Save times out after the insert | Retry gives 200 `idempotentReplay`, with exactly one document stored |
  | D. Unauthorised write | A missing, `null` or foreign Origin, a foreign Host or a non-loopback peer gets 403 before any insert. State 6b, no Retry |
  | E. No internet | Local controls, drafts and steps already scheduled all continue |
  | F. Outdated schema | An unsupported `schemaVersion` gives `SCHEMA_VERSION_UNSUPPORTED`, never reinterpreted |
  | Unique index not confirmed | Writes give 503 `INDEX_MISSING` and `insert` is never called (MDB-R33) |
  | Gateway not running, or library flag off | State 7 after one probe; later probes only on a user action, with backoff; **Check again** picks up a gateway started later. Flag off: not in the bundle, zero requests |
  | Refresh | A reload restarts the simulation. Drafts, a pending or failed save and the runner are cleared, and steps already scheduled go with the old run. The Atlas library persists (William §7, canonical §12) |

- **Required approvals.** MDB-D1. MDB-D3 only if the gateway is ever deployed beyond the laptop.
- **Acceptance criteria.**
  - Every row passes.
  - A `grep` of `dist/` finds no `mongodb://`, `mongodb+srv://`, `MONGODB_` or Atlas host.
  - No `.env` file is committed; `.gitignore` already covers `.env*` and keeps `.env.example`.
  - Logs hold only the server request id, a client `requestId` only when it matches XI-11's pattern, the route, status and latency.
  - With the shows module configured, the gateway still **refuses to start** on any address other than `127.0.0.1` unless MDB-D3's server-side authorisation is configured and enabled. A flag alone is never enough, and the refusal message names no secret (XI-12; canonical §10.7; MDB-T20).
  - The README runbook says: never add `0.0.0.0/0` to the Atlas access list; use a temporary entry with an expiry for the venue address, which is shared with every attendee; use a dedicated demo user, rotated or deleted after the event; load the URI only from the gateway's own ignored `.env` (for example `node --env-file`), never from shell history or a command line (MDB-R32). Running Vite or the proxy with `--host` is forbidden in the MVP (MDB-R34). `strictPort` is a `vite.config.ts` change for its owner, listed, not made here (MQ-5).
- **Unit tests.** MDB-T20, T21 and T24.
- **Integration tests.** Scenarios A, C and E against the test database (T37–T40 group).
- **Security tests.** MDB-T20, T21 and T24, then T19, T22 and T23 re-run with the guard on.
- **Regression checks.** The standard regressions, plus T34–T36 with the gateway stopped.
- **Rollback approach.** Revert, then stop using real Atlas: without this package, WP-04 is test-only (see its purpose).
- **Implementation risk.** Medium. An Origin check is not authentication, which is why the MVP is localhost-only and the README says so.
- **Expected demonstration evidence.** The test report. Optionally a drill: cut Atlas access in the middle of a show, and the loaded show keeps flying.

### MDB-WP-08 Validation and end-to-end acceptance

- **Purpose.** William's phase 7 ("Verify") and his 10-step test (§10): generate, save, verify in Atlas, refresh, open, retrieve, load, execute, then an outage. William: "Do not claim live Atlas verification without an actual read-after-write test".
- **Dependencies.**
  - MDB-WP-02 to MDB-WP-07.
  - MDB-D1.
  - GF-WP-10 and GF-WP-12 for step 2. **Without them, step 2 uses a manual draft and is recorded as such** (MDB-D7), never as Gemini output. After GF-CC-01, an offline-authored scene is saved as `schemaVersion` 2 with `source: 'gemini'` and a `generator`, never as `manual` (canonical §15). What `generator.integrationVersion` holds with no gateway is open (MQ-13).
  - Step 8 uses Load as drafts in the MVP (WP-06); the runner only after MCR-21.
- **Priority.** Essential for any claim. Suggested P1.
- **Lane.** B. Assignee: TBD by Arnav.
- **Allowed files.**
  - `integrations/gateway/test/e2e.live.test.ts` (opt-in).
  - `tests/persistence/acceptance.test.ts`: steps 7–10 on the memory repository with a fixture.
  - An evidence note in the PR.
- **Proposed interfaces.** None.
- **Required approvals.** MDB-D1. Arnav decides whether any result is cited in submission material, after MLH eligibility is checked (issue #1).
- **Acceptance criteria.**
  - All 10 steps are run against a separate test database. Each step records time, SHA, document `_id` (never the URI) and outcome.
  - The full `check.sh` output is recorded, including any pre-existing failures.
  - The networking-off demo is recorded separately.
  - Known limitations are listed. At least: a saved show is not a deterministic replay (seed, events, params and SHA are not stored, MD-14), and an Atlas-only show is unavailable offline unless exported.
- **Unit tests.** None new.
- **Integration tests.** MDB-T37–T40.
- **Security tests.** Re-run T19–T24 on the final build.
- **Regression checks.** The standard regressions and T34–T36.
- **Rollback approach.** Not applicable.
- **Implementation risk.** Low in code, high in time: Atlas set-up, the venue network, and Gemini availability. If it does not run, report "not executed" rather than a partial claim.
- **Expected demonstration evidence.** The step log, a recording with no secrets visible, and the `check.sh` output. **This would be the feature's first executed evidence.**

### MDB-WP-09 (optional) Local export and import (offline path)

- **Purpose.** MDB-FR-11. William §7 and §8.4: an Atlas-only show "cannot be loaded while offline unless previously cached or exported locally". This is outside William's MVP (MCR-09). It is the NFR-04-compatible way to keep a show for the judged demo (MD-11), and it aligns with GF-WP-09's offline library and with X-IN files.
- **Dependencies.**
  - MDB-WP-02 and MDB-WP-06 (Load as drafts).
  - P2-WP-30a (X-IN and its importer, provisional: #110). If 30a has landed an X-IN file picker in the app, this package adds Export beside it instead of a new panel.
  - GF-WP-09 for format alignment (provisional: #117).
  - GF-WP-11, if it takes the `show save`/`show load` names first (MDB-D9 keeps them for this file path).
  - Base #113 (merged), for the mount line.
  - **No MDB-D1**: there is no network.
- **Priority.** Optional, with high value for demo safety: it is the only operator-reachable save and load without MDB-D1 (MDB-R25). Suggested P2.
- **Lane.** C. Assignee: TBD by Arnav.
- **Allowed files.**
  - `src/app/compose/showFile.ts` (new).
  - `src/app/ui/CompositionFiles.ts` (new, proposed name): a **file-only** panel with Export, Import and Load as drafts. It has no network code, so it lives outside `src/app/live/` and ships in the default build (XI-14). It never reads the library flag.
  - One mount line in `src/app/main.ts` (shell-owner sign-off), since `main` no longer runs the `createPanels` loader (§1).
  - `tests/persistence/showFile.test.ts`.
  - Console wiring in `commands.ts` waits for its owner.
- **Proposed interfaces.**

```ts
// src/app/compose/showFile.ts — files are X-IN's `encore.composition` v1/v2 (XI-15); this package defines no other file kind
export function exportComposition(title: string, c: Composition): Blob;
  // movements → cues, cue name "<title> i/k"; v2 keeps holdTicks (once approved); until then v1, and the panel says holds are dropped
export function importCompositionFile(bytes: Uint8Array, params: Params):   // X-IN steps 2–4: 64 KiB, strict UTF-8, depth scan, prototype keys, schema
  { ok: true; title: string; composition: Composition } | { ok: false; errors: CompositionIssue[] };   // then the shared validator; a v1 cue has no hold, so DEFAULT_HOLD_TICKS (600) is used, as advice only
```

  **File kinds (XI-15).** `encore.composition` v1 is X-IN today: cues `{ name, recipe }`, no holds. The proposed v2 (#110 boundaries, needs Arnav) adds an optional per-cue `holdTicks` and, after GF-CC-01, generated recipes (16 KB per cue). `saved_shows.composition` maps movements ↔ cues. Exporting a show with holds needs v2 (MCR-20, still open; §6, item 2). Import ends in Load as drafts (X-IN step 7). No other kind name is used (not `encore.show`, not `CompositionFile`).
- **Required approvals.** Arnav approves `encore.composition` v2 with #110's owner (MCR-20).
- **Acceptance criteria.**
  - With v2: export then import gives the same canonical composition and `contentHash`. With v1: the same recipes in order, and the panel says the holds were dropped.
  - Import applies X-IN's 64 KiB gate, rejects prototype keys, and uses the same validator. A cue with a rejected generated recipe fails import (strict path, G2-1).
  - It works with networking off and no gateway, from the mounted panel, and the panel sends zero requests.
- **Unit tests.** MDB-T41, over the T01–T10 corpus.
- **Integration tests.** MDB-T41 (networking off, no gateway) and T35's file path.
- **Security tests.** Oversized, `__proto__`, deeply nested and invalid-UTF-8 files (T41).
- **Regression checks.** The standard regressions.
- **Rollback approach.** Remove the mount line and the panel. WP-05's panel is a separate file and is unaffected.
- **Implementation risk.** Low, apart from the format overlap with X-IN and GF-WP-11.
- **Expected demonstration evidence.** Export → networking off → import → Load as drafts → inject each draft → the show flies.

## 3. Sequence

```mermaid
flowchart LR
  SUB{{Base submission done}}
  D1{{MDB-D1 = D3 = GF-D1 = TIG-D1, XI-9}}
  D4{{MDB-D4 gateway location}}
  B113{{#113 shell merged}}
  SK{{"shared gateway skeleton, XI-12: first approved of MDB-WP-03 / GF-WP-12 / TIG-03"}}
  P30[P2-WP-30a validate.ts; 30b eslint ignore]
  SUB --> W01[WP-01 verify · phase 1 Inspect] --> W02[WP-02 model + validator · phase 2 Design]
  P30 -.-> W02
  W02 --> W06[WP-06 Load as drafts; runner later · phase 4 Integrate]
  D1 --> W03[WP-03 repository · phase 3 Persist]
  D4 --> W03
  SK -.->|built here if WP-03 is first| W03
  W02 --> W03 --> W04[WP-04 API · phase 3 Persist]
  W04 --> W05[WP-05 Saved compositions · phase 5 UI]
  W06 --> W05
  B113 --> W05
  W05 --> W07[WP-07 faults + security · phase 6 Harden]
  W07 --> W08[WP-08 e2e · phase 7 Verify]
  W06 --> W09[WP-09 file-only panel + mount · optional]
  B113 --> W09
```

**Mapping to William's phases** (§11):
1. Inspect is WP-01.
2. Design is WP-02, together with the canonical spec.
3. Persist is WP-03 and WP-04.
4. Integrate is WP-06.
5. UI is WP-05.
6. Harden is WP-07.
7. Verify is WP-08.

His "stop/reassess if a major refactor … is required" applies to every package. None of them edits `src/agent`, `src/sim`, `src/observer`, `src/cli` or `src/contracts`.

**What can run in parallel:**
- WP-03 and WP-04 (lane B, behind MDB-D1) alongside WP-06 (lane C, offline);
- WP-05 against a fake client, alongside WP-04;
- WP-09, any time after WP-06, in parallel with WP-05 (separate files, separate mount lines);
- GF-WP-12 and the Tiger module, if approved, on the one skeleton (XI-12): each adds its routes, config section and health entry, and none redefines the guard or the errors.

**If MDB-D1 is late:** WP-01 → 02 → 06 → 09 still delivers save-to-file and load-into-the-swarm with no network code, operator-reachable through WP-09's mounted file-only panel. None of these four creates anything under `integrations/`.

## 4. File-ownership matrix

| File | Created or edited by | Also touched by | Sign-off |
|---|---|---|---|
| `src/app/compose/validate.ts` (incl. moved `validateText`, `TEXT_MAX`, and the composition validator) | P2-WP-30a or WP-02, whichever lands first; the other extends it (XI-13) | GF-WP-10 | Arnav (XI-2 coverage) |
| `src/app/ui/commands.ts` | one re-export line for `validateText`, `TEXT_MAX` (WP-02, if P2-WP-30a has not moved them) | — | `commands.ts` owner |
| `src/app/ui/Composer.ts` | re-export line (WP-02, if P2-WP-30a absent) | #121, GF-WP-10, P2-WP-05, P2-WP-23 | Composer lane |
| extracted pure `canonicalJson` helper | XI-7's one shared proposal | WP-02, Gemini, Tiger | Arnav |
| `src/app/compose/showLoad.ts` | WP-06 | — | lane A review |
| `src/app/compose/showFile.ts` | WP-09 | — | — |
| `src/app/live/shows.ts`, `src/app/live/SavedCompositions.ts` | WP-05 | WP-07 (states) | MDB-D1; folder skeleton owner open (XI-14, OIB-Q3) |
| `src/app/ui/CompositionFiles.ts` (file-only panel) | WP-09 | — | — |
| `src/app/main.ts` | one flag-guarded mount line (WP-05); one file-panel mount line (WP-09) | — | shell owner |
| `tests/persistence/**` | WP-02, 05–09 (separate files) | gateway tests read `fixtures/` | — |
| The shared gateway skeleton (XI-12): `integrations/gateway/{package.json,package-lock.json,tsconfig.json,README.md,.env.example}`, `src/server.ts`, `src/http/guard.ts`, `src/http/errors.ts`, `src/config.ts`, `src/health.ts` | the first approved of WP-03 / GF-WP-12 / TIG-03 | the other modules add their own lines (routes, config section, health entry) and never redefine guard or errors | MDB-D1, MDB-D4 |
| `integrations/gateway/src/{shows,db}/**`, the shows section of `src/config.ts`, `scripts/shows-setup.ts` | WP-03 (incl. the `shows/validate.ts` re-export), 04 | WP-07 (`shows/rateLimit.ts`, its call in `routes.ts`, and the shows rate values in `config.ts`) | MDB-D1 |
| `integrations/gateway/src/http/body.ts` | WP-04, only if the skeleton has no body reader | GF-WP-12, Tiger | — |
| `integrations/gateway/test/**` | WP-03 to 08 (separate files) | — | — |
| `eslint.config.js` (ignore `integrations/**`) | P2-WP-30b | — | build-config owner |
| `vite.config.ts` (`/api` dev proxy, `strictPort`) | no package | — | build-config owner, later (MQ-5) |
| `src/agent`, `src/sim`, `src/observer`, `src/cli`, `src/contracts`, root `package.json`, CI, `actions.ts`; `main.ts` and `commands.ts` beyond the lines above | **none** | — | — |

**Same-origin `/api` is not decided here** (MD-1). There are two options: a Vite dev proxy, or the gateway also serving the built `dist/` on `127.0.0.1`. Either way, the NFR-04 demo keeps using `npm run preview`, and the default build makes zero external requests (XI-9).

## 5. Reconciliation with existing work

- **MongoDB issues: none exist.** These packages are new.
- **GF-WP-15** reserves MongoDB and Tiger Data persistence, as interface only. Its MongoDB half → MDB-WP-02 to 08, from William's own MongoDB spec (XI-6, MCR-08); GF-WP-15 points here in #117's revision. Its Tiger Data half belongs to the Tiger plan (#142). Nobody is assigned (XI-10).
- **Data ownership (XI-6).** `encore.saved_shows` is the canonical show-library model. The field list in William's earlier Gemini handoff §11 (`formationId`, `sceneSpec`, `droneCount`, `generationMs` and others) is superseded by his MongoDB spec, and the Gemini docs point to this model (MCR-12). MongoDB holds no telemetry, and no experiment catalogue lives in `saved_shows` (Tiger TD-11). Identity links run one way: Gemini `sceneHash` per generated recipe, MongoDB `contentHash` per saved composition, Tiger `compositionId` in its import manifest (MD-13).
- **Generated recipes (after GF-CC-01).** They are stored only in `saved_shows` `schemaVersion` 2 (XI-8). Save and library load call the strict expansion path, so a rejected generated recipe fails there, while `expandRecipe` stays total for the swarm (G2-1). A recipe's `sceneHash` is a checked label, recomputed on load; `contentHash` identifies the whole saved composition (XI-6, XI-7).
- **GF-WP-12** uses the shared `integrations/gateway/` (XI-1; the Gemini spec §10.4 now names it; MCR-07). **The gateway skeleton** (server, guard, errors, config, health and the dependency policy) is built once, by whichever of MDB-WP-03, GF-WP-12 and TIG-03 is approved first (XI-12); this answers MQ-8. WP-03 never creates a second folder or a second guard. The Tiger plan places its module at `integrations/gateway/tiger/` and this plan at `src/shows/`; one layout is chosen with the skeleton (MDB-D4; `docs/planning/tiger-data-integration-work-packages.md` (#142)).
- **Gemini CR-25** ("the app never queries MongoDB at run time") is corrected by XI-5 in #117: the app may call the gateway while the simulation runs, never inside the tick loop or a decision path (MCR-10).
- **GF-WP-11** uses `show save` and `show load` for event-log replay files, which are a *deterministic replay*. A saved show explicitly is not one (William §8.4), and a replay log is not a composition kind (XI-15). Both features stay, under distinct names. Gemini proposes `replay save`/`replay load`; MDB-D9 recommends keeping `show save`/`show load` for the file path (WP-09) and no console command for the cloud library in the MVP. Arnav allocates the names.
- **Issue #1 (sponsor brief).** MLH's "Best Use of MongoDB Atlas" rules were unpublished at audit time ([`BRIEF.md`](../competition/BRIEF.md) §5, §7). Capture them before any submission text claims the track. William: eligibility is "not guaranteed by merely using Atlas". No one is assigned or pinged here; Arnav decides how #1 is updated.
- **#112, #121 and #113.** The Composer is merged (#112), its follow-ups are in #121, and #113 has merged and mounts panels explicitly. WP-05 and WP-09 each add one mount line with the shell owner's sign-off, and no package edits any other #113 file.

## 6. Open inconsistencies for Arnav

These are reported, not resolved here. The canonical spec records them as MCR rows and review questions MQ-*. **Resolved since the first draft:** hold spacing (`t_{i+1} = t_i + max(L, T_i + h_i)`, canonical §8.2); live reads (X-RUN/live and X-PERSIST (provisional, #110), XI-4; CR-25 per XI-5); the size budget (v1 64 KiB; v2 = movements × GF-NFR-04 cap + overhead, set when GF-CC-01 is approved, XI-8); `requestId` (XI-11, which closes MQ-12); who builds the gateway skeleton (XI-12, which answers MQ-8: the first approved module work package); where the pure validator lives (XI-13, which closes MQ-6 and item 3); where app network code lives (XI-14).

1. **Who schedules.** *Resolved for the MVP* by XI-15 and MDB-D6: Load as drafts (X-IN step 7), so every injection is an operator action. Still open for the follow-up runner, which schedules *k* injections after one confirmation against X-IN's "never schedules injections by itself" (MCR-21, MQ-3).
2. **Composition formats** (MCR-20, MQ-2: still open). XI-15 fixes the names:
   - files are X-IN's `encore.composition`: v1 has `cues: [{ name, recipe }]`, no holds, and rejects the key `movements`; the proposed v2 (#110 boundaries, needs Arnav) adds an optional per-cue `holdTicks` and, after GF-CC-01, generated recipes;
   - MongoDB stores `saved_shows.composition` (MD-2: `movements: [{ recipe, holdTicks }]`, no names), mapped movements ↔ cues;
   - GF-WP-11's replay log is not a composition kind;
   - `ControlStatus.composition` is a boolean.
   XI-15's recommendation: approve v2, because exporting a show with holds needs it. Until then WP-09 exports v1 and says the holds are dropped. Arnav decides with #110's owner.
3. **XI-2 coverage.** *Closed by XI-13.* The composition validator lives in `src/app/compose/validate.ts`, which XI-2's allow-list includes, and `validateText` and `TEXT_MAX` move into it (WP-02).
4. **Keyset cursor in the MVP.** MD-6 specifies keyset pagination. If WP-04 is too large for one PR, the MVP could ship `limit ≤ 50`, newest first, `nextCursor: null`, with the cursor as a follow-up package. That departs from MD-6, so Arnav decides.
5. **P2-WP-30a's allowed files** (provisional, #110). *Resolved.* They now list the `validateText`/`TEXT_MAX` move into `validate.ts` and `commands.ts` for the move only, with one re-export line (owner sign-off), as XI-13 requires. The Phase 2 file matrix lists it too. Whichever of 30a and WP-02 lands first makes the move.

## Gating

- **No package starts before the base submission** (Devpost by 10:15 Sun 15 Nov 2026, hard deadline 11:00) unless Arnav explicitly approves. These are Track P packages ([`PHASE2_ROADMAP.md`](PHASE2_ROADMAP.md), provisional: depends on #110).
- **The networked packages are blocked on MDB-D1**: WP-03, WP-04, WP-05's client, WP-07 and WP-08. MDB-D1 = Phase 2 D3 = GF-D1 = TIG-D1, **one decision** (XI-9): it amends NFR-04, the AGENTS ground rule, the contract §12 row and the decisions log, scoped to the optional gateway only, under X-RUN/live and X-PERSIST (provisional, #110). The core and the default build stay offline: library UI off unless a non-secret flag enables it, zero external requests by default, and the NFR-04 acceptance test unchanged. WP-01, 02, 06 and 09 have no network code but are still gated by the submission rule and Arnav's approval.
- **No package changes a contract.** MDB-CC-01 (`composeShow`) is deferred: **PROPOSED CONTRACT CHANGE — REQUIRES ARNAV APPROVAL.**
- **Reviews are done by Arnav's own agents.** Agents never ping William or Haris, and no package is assigned to them (XI-10). William keeps the sponsor-specific decisions.

## Issue-body template

Paste into [`.github/ISSUE_TEMPLATE/task.yml`](../../.github/ISSUE_TEMPLATE/task.yml) when, and only when, Arnav approves opening the package.

```markdown
**Objective**
MDB-WP-NN <title>. <Purpose.> Source: docs/handoffs/Encore_MongoDB_Atlas_Implementation_Spec.md §n; plan: docs/planning/mongodb-integration-work-packages.md#mdb-wp-nn-...

**Acceptance criteria**
- [ ] <copied from the package>
- [ ] Tests MDB-Txx–Tyy pass (docs/validation/mongodb-show-library-evaluation.md)
- [ ] Standard regressions: check.sh; isolation; networking-off build; check.sh with integrations/ deleted; stateHash S0–S5 seed 1
- [ ] Networked packages: no secret in dist/, logs or error bodies
- [ ] PR with `Closes #` and handoff block; executed tests listed, planned-only checks marked

**Scope and expected files**
In scope: <allowed files, exact paths>
Out of scope: src/agent, src/sim, src/observer, src/cli, src/contracts, root package.json, CI, main.ts and other #113-owned files (except the single lines a package's allowed files name, with owner sign-off); any contract change

**References**
Canonical spec: docs/integrations/mongodb-atlas-show-library.md (MCR-xx, MDB-D1…D9); rulings XI-1…XI-15
Contract: docs/design/contracts-and-algorithms.md §<n>

**Depends on / blocks**
Depends on: MDB-WP-xx (#…), base #113, P2-WP-30 (provisional: #110), GF-WP-xx (provisional: #117), <MDB-D1 / D2 / D4>
Blocks: MDB-WP-xx

**Test requirements**
<unit, integration, security; rollback; risk>

Networked: yes/no · Lane: A | B | C · Assignee: TBD by Arnav · Priority: <Essential/Optional>, P<n>
Target branch: feat/<issue#>-mdb-wp-nn-<slug>
```

## Instruction

**Do not open these issues and do not start coding any package until Arnav approves, and, for networked packages, until MDB-D1 is decided.** Approval is recorded as a row in [`decisions-and-risks.md`](decisions-and-risks.md).

## Appendix A. William's §12 coding-agent brief (source material — not authorisation)

This is reproduced verbatim from the [source handoff](../handoffs/Encore_MongoDB_Atlas_Implementation_Spec.md) §12. **It authorises nothing.** A future agent follows the packages above, applying the deltas listed after the brief.

> **Task:** Implement MongoDB Atlas Saved Show Library for Encore.
>
> **Objective:** Enable saving, browsing, retrieving, and reusing Gemini-generated drone compositions via MongoDB Atlas, as a small real feature suitable for demonstration at DurHack. Gemini and TigerData are reported to be implemented in the current branch; inspect their actual code before changing anything.
>
> **First inspect:** `package.json`, application entry points, server/deployment setup, Gemini integration and validated output, TigerData integration, `src/contracts/score.ts`, existing score validation, operator score-injection pathway, tests, build scripts, and environment conventions. Report discrepancies from this specification.
>
> **Architecture:** Gemini prompt → generated composition → score validation → MongoDB Atlas save → Saved Shows UI → MongoDB retrieval → validation → existing operator pathway → decentralized simulation. Keep TigerData responsible for telemetry. No MongoDB in agent/simulation ticks.
>
> **Data:** Use `encore.saved_shows`. Save schema version, title, prompt, validated score/composition, source, actual model ID when available, and timestamps. Reuse existing `Score`, `Movement`, and `Recipe` contracts. Preserve the semantics of `ScoreVersion`; assign runtime version via the existing operator mechanism. Do not store frames, telemetry, or entire run histories in this collection.
>
> **API:** Reuse existing backend. Add `POST /api/shows`, `GET /api/shows`, and `GET /api/shows/:id`. Use the official MongoDB Node driver, pooled connection, runtime validation, bounded payloads, pagination, ObjectId checks, sanitized errors, authorization, and idempotent creation. Never expose Atlas credentials to browser code.
>
> **UI:** Save Show after Gemini generation, Saved Shows panel, list metadata, retrieve and load selected show, loading/empty/error/success states. Failed save must not discard generated content. Do not mock the production DB workflow.
>
> **Constraints:** Preserve `src/agent/`, `src/sim/`, existing observer and CLI behavior, score contracts where possible, and TigerData responsibilities. Do not bypass simulated radio or directly assign drone targets. Cloud failures must not block local simulation.
>
> **Failure tests:** Atlas unavailable, invalid generated score, corrupt saved document, malformed ID, duplicate retry, oversized request, unauthorized write, network timeout, full internet outage, outdated schema.
>
> **Acceptance:** Generate → save to real Atlas → verify stored document → refresh → retrieve → load through operator → execute show. Run the full current test/typecheck/lint/build suite. Report modified files, setup, executed tests, known limitations, and any unresolved risks. Do not claim live Atlas verification without an actual connection and read-after-write test.
>
> **Priority:** Smallest secure, demonstrable implementation. If major refactoring becomes necessary, stop and report the blocker rather than expanding scope.

**Deltas a future agent must apply:**
1. **Gemini and TigerData are not implemented** at 4c41f75. Start from manual Composer drafts; Gemini drafts come with GF-WP-10.
2. **There is no backend to reuse.** Use the one shared optional `integrations/gateway/` (XI-1, MDB-D4), module `shows`, on the one gateway skeleton (XI-12), with its own `package.json`, `node:http` and the `mongodb` driver. The root `package.json` stays untouched.
3. **Store `composition`** `{ v: 1, movements: [{ recipe, holdTicks }] }`, not `score`, and with no `version`, `startTick` or `transitionTicks` (MD-2).
4. **Load as drafts** in the MVP (XI-15, MDB-D6): each movement becomes a Composer draft the operator injects. A cue runner of operator injections into one chosen drone, each with a fresh version assigned by the controller, comes only after MCR-21 (WP-06). Do not use the `startTick 0` / `{0,0}` example version: origin 0 is a drone id, and the preloaded score uses `OPERATOR` = −1.
5. **Add idempotency and fixed errors:** `operationId` with an `Idempotency-Key` header, compared by `requestHash`; `contentHash` (sha256 of `canonicalJson`, XI-7); 409/413/415/429 and the gateway's one error envelope (MD-7, MD-8, XI-3).
6. **"Authorization" in the MVP means the skeleton's guard** (XI-12): loopback bind and peers, a Host allow-list, and an exact Origin on every non-GET. A public deployment needs MDB-D3 (MD-9).
7. **One validator module, run three times.** The gateway imports the app's pure `src/app/compose/validate.ts`, so its checks are complete, trial expansion through the strict path included (MD-4, XI-2, XI-13, G2-1).
8. **Nothing networked before MDB-D1** (= D3 = GF-D1 = TIG-D1, XI-9), and nothing at all before the submission and Arnav's approval.
9. **"Do not mock the production DB workflow"** holds for the acceptance run (WP-08). Unit tests mock `ShowsRepository`, as William's §10 asks.
10. **App network code only in `src/app/live/`,** behind the build-time `VITE_SHOW_LIBRARY` flag (XI-14). UI labels follow MDB-D9 ("Saved compositions", "Save composition").
