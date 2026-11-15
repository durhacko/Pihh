# MongoDB show library evaluation

> **STATUS: PROPOSED — NOT IMPLEMENTED.** Nothing in this file has been built, run or measured. There is no MongoDB, Gemini or Tiger Data code and no backend on `main` at `4c41f75`. Every test below is a **planned check**. §7 records the executed evidence, and there is none yet.

Purpose: the validation specification for the optional Encore Show Library (save, browse, retrieve and load reusable compositions through MongoDB Atlas). It defines tests `MDB-T01`…`MDB-T41`, the live end-to-end acceptance with its evidence, and the gates. Status: proposed. Owner: Arnav (integration, issue #130). Source author: William Pimentel (`wpimento`), [MongoDB Atlas implementation spec](../handoffs/Encore_MongoDB_Atlas_Implementation_Spec.md) §10 "Testing and acceptance criteria", plus the failure scenarios in §9 and the risks in §8. Audit base: `origin/main` `4c41f75`.

Sibling documents, written together with this one:

- **Canonical specification:** [`../integrations/mongodb-atlas-show-library.md`](../integrations/mongodb-atlas-show-library.md). It defines the document model, the API and its error codes, requirements `MDB-FR-*`/`MDB-NFR-*`, contract change proposals `MDB-CC-*`, conflict records `MCR-*`, decisions `MDB-D*` and risks `MDB-R*`. Where a bound or code below differs from it, the canonical spec wins and this file is corrected.
- **Work packages:** [`../planning/mongodb-integration-work-packages.md`](../planning/mongodb-integration-work-packages.md), `MDB-WP-01`…`MDB-WP-08` plus optional `MDB-WP-09`. Its numbering is the WP column below.
- This file is the only place `MDB-T*` tests are defined. The other two cite them.

Linked, not restated: the base [evaluation and tests](evaluation-and-tests.md) (metrics, scenarios, base tests T01–T19, gates, wording rules), the [Gemini formation evaluation](gemini-formation-evaluation.md) (GF-T01…GF-T40; provisional: depends on #117) and the Phase 2 [evaluation](PHASE2_EVALUATION.md) (P2-T35; provisional: depends on #110).

---

## 1. Scope and evidence rules

The feature is persistence, not simulation. Almost everything here is decided by deterministic pass/fail tests. The only flight evidence needed is that a loaded show reaches the swarm through the **existing** operator pathway, with determinism unchanged. Flight quality is covered by the base and Gemini evaluations.

| Kind | Where it runs | What it may establish | Permitted wording |
|---|---|---|---|
| **Offline** (unit, UI, scans, build) | Core `npm run check`, or a scan over `dist/`; no network, no database | Validation, serialisation, UI states, load scheduling, determinism, isolation, bundle hygiene | "MDB-Txx passes on commit X" |
| **Mocked service** (integration) | The optional service's own package, in process, with a fake `ShowsRepository` | HTTP behaviour, statuses, error envelope, idempotency logic, limits | "Against a fake repository, the service returns …". **Never** "saved to Atlas" |
| **Live** | The service against a separate Atlas test database (§4) | Real persistence, unique index, BSON types and failure behaviour | "Read-after-write verified against Atlas on date D, `_id` …" |
| **Acceptance** | A person in a browser, following §5 | William's whole workflow | Only with the §5 evidence attached |

Rules:

1. **No cloud claim from a mock.** William: "Do not claim live Atlas verification without an actual read-after-write test" (§10).
2. **Core checks stay offline.** Mocked-service and live tests never run under the root `npm run check` or `bash scripts/check.sh`. They live in the shared optional gateway's package, `integrations/gateway/` (independently optional `gemini`, `shows` and `tiger` modules; MCR-07, MDB-D4), like the Gemini gateway tests ([GF §5.8](gemini-formation-evaluation.md#58-gateway-class-a-mode-live-gateway-only-gated-on-gf-d1), provisional: depends on #117).
3. **Live tests are opt-in.** They run only when the test-database environment is set, and never against the demo database. If they are skipped, they are reported as not run.
4. **Validated is not flown, and loaded is not flown.** "Loaded" means "injections scheduled".

### 1.1 Repository facts the tests rely on

Checked in this worktree at `4c41f75`.

| Fact | Where | Consequence |
|---|---|---|
| `Recipe` is exactly `text`, `sphere` or `helix`. `RGB` is "0..1" | `src/contracts/score.ts`, `src/contracts/params.ts:7` | `generated` is accepted only after GF-CC-01 |
| The font is A–Z, 0–9 and space. `litCells` upper-cases and **draws an unknown character as a space, silently** | `src/score/font.ts` | Expansion cannot catch glyph errors, so the validator must (T03) |
| `validateText` allows 1–20 characters (`TEXT_MAX`), not all spaces, each in `FONT` as typed or as an ASCII lower-case letter, checked per character | `src/app/ui/commands.ts:115`, `:288` | T03 reuses these rules |
| `expandRecipe` **clamps** palette channels (`clamp01`; `NaN` becomes 0) and never rejects a palette. `validateDraft` only warns about reserved colours | `src/score/expand.ts`, `src/app/ui/Composer.ts:83` | The shared validator adds the finite-[0, 1] check (T04). This enforces the existing contract and is not a contract change |
| An unknown kind reaches recipe `switch`es that have no matching case | `src/score/shapes.ts:86`, `:100` | Kinds are checked before any expansion or injection (T02) |
| `inject` needs a selected live drone, takes an optional later `at`, allows one `INJECT_SCORE` per tick, and upper-cases text after `/^[A-Z0-9 ]{1,20}$/i` | `src/app/actions.ts` | Load scheduling (T30) |
| The controller replaces `authoredScore` when it **schedules** an `INJECT_SCORE`, so a later `at` injection is composed from the previously scheduled score | `src/app/actions.ts` (`schedule`); `tests/app/actions/composition.test.ts` | Scheduling chains ([spec §8.3](../integrations/mongodb-atlas-show-library.md#83-the-chaining-question-answered-from-the-code)). T30 asserts it |
| `composeNext` gives version `{issuedTick: tick, origin}` and movements `[current, new]`, the new one at `tick + scoreLead`, with transitions in whole ticks (`Math.ceil`) | `src/score/compose.ts`, `src/score/timing.ts:36` | T31. `origin` is the **selected drone's id**, not `OPERATOR` (−1) |
| `canonicalJson` sorts keys at every level and throws on a non-finite number | [`src/cli/run.ts:27-36`](../../src/cli/run.ts) | `contentHash` = sha256 of it (T01). The gateway imports it only once extracted to a pure module (one proposal, owner Arnav) |

---

## 2. Fixtures and test doubles

All fixtures are hand-written from the current contracts. None needs Gemini, the network or a database.

| Fixture | Content |
|---|---|
| `FX-SHOW` | William's intent as a composition: `{ v: 1, movements: [ {text "HELLO", holdTicks 600}, {sphere, holdTicks 600}, {helix, holdTicks 600} ] }`, with a palette on the text movement (600 ticks = `DEFAULT_HOLD_TICKS`, 30 s) |
| `FX-ONE` | One `sphere` movement, with no palette |
| `FX-BAD/*` | One file per rejection reason, each tagged with its expected error code and JSON path |
| `FX-WILLIAM-S4` | William's §4 document verbatim: a `score` field with `version {issuedTick: 0, origin: 0}`, `startTick` and `transitionTicks` (MCR-04 `score` vs `composition`; MCR-06 the example version) |
| `FX-V0`, `FX-V2` | `schemaVersion` missing or 0, and 2 |
| `FX-CORRUPT/*` | Stored documents with a bad kind, a hash mismatch, an injected `version`, or a wrong BSON type |
| `SENTINEL` | Dummy `MONGODB_URI=mongodb+srv://sentinel-user:SENTINEL-PASS-7f3a@sentinel.invalid/` and `MONGODB_DB=sentinel_db`, valid nowhere |
| `FakeShowsRepository` | An in-memory `ShowsRepository`: unique `operationId`, newest-first keyset listing, and switchable failures (`unavailable`, `timeout`, `duplicateKey`, `corrupt`, `throw`) |

`ShowsRepository` is the seam William asks for ("Mock the repository/data-access interface for unit tests", §10). The fake reproduces the unique index's duplicate-key behaviour. T39 checks that the real index matches it.

---

## 3. Tests MDB-T01–MDB-T41

**Levels:**

- *unit*: pure functions;
- *integration*: the service in process with the fake repository;
- *security*: scans, fuzzing and adversarial inputs;
- *UI*: a headless DOM;
- *e2e*: the whole app, with no Atlas;
- *live*: a real Atlas test database.

**WP** names the delivering package, numbered as in the work-package file. Bounds are the canonical spec's (§7.1, §9 rules R1–R16, §10; its planning values stay planning values here). Each test checks the bound itself and one step past it.

### 3.1 Validation and serialisation (T01–T10)

One pure validator runs everywhere. It has no DOM and no three.js, and it runs at four call sites: in the app before save and before load, and in the gateway on write and on read ([spec §9](../integrations/mongodb-atlas-show-library.md#9-validation-md-4)). The gateway imports this same module by relative path (decision XI-2, superseding Gemini CR-24): one implementation, not two copies. Every test in this group targets that module.

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T01** | Composition round-trip | unit | `FX-SHOW`, `FX-ONE`; canonical JSON; BSON `serialize`/`deserialize` in the service package | `validate(parse(serialise(c)))` accepts and deep-equals `c`: same movement count, order, kinds, text, palette numbers bit for bit, and `holdTicks`. `contentHash` is the lower-case hex sha256 of `canonicalJson(composition)` (§1.1): the same for two key orders and after a BSON round-trip, and equal to the shared corpus's hashes. Tiger's manifest may cite it as `compositionId` (provisional: #142) | 02 |
| **MDB-T02** | Unsupported recipe kinds | unit | `FX-BAD/kind-*`: `generated` (before GF-CC-01), `cube`, `""`, missing, numeric, `"Text"` | Each is rejected with reason `UNSUPPORTED_RECIPE` at `movements[i].recipe.kind`, without throwing and without calling `expandRecipe`. After GF-CC-01, `generated` is accepted only in `schemaVersion` 2 and only through the Gemini validator ([GF-T01](gemini-formation-evaluation.md#51-schema-and-validation-class-a), provisional: depends on #117) | 02 |
| **MDB-T03** | Text glyphs | unit | The real `FONT`; `validateText` cases | **Accepted:** every `FONT` key; ASCII lower case, stored upper-cased (R12; the hash is taken after normalisation); exactly 20 characters. **Rejected** with reason `INVALID_TEXT`: empty, all spaces, 21 characters, `!`, `-`, `é`, `ß`, `ı`, `Ａ`, tab, newline, U+200B, an emoji, a lone surrogate. Non-canonical text read back from storage is rejected, not normalised | 02 |
| **MDB-T04** | RGB palettes | unit | `FX-BAD/palette-*`, as objects and as raw JSON | **Rejected** with reason `INVALID_COLOUR`: `NaN`, `±Infinity` (objects only, since JSON cannot carry them), `null`, −0.01, 1.01, `[255, 0, 0]`, `"#ff0000"`, 2 or 4 channels, 1 or 3 palette entries, extra keys. **Accepted:** `[0,0,0]`, `[1,1,1]`, and no palette at all. Reserved-colour warnings never block a save | 02 |
| **MDB-T05** | Timing (`holdTicks`) | unit | `FX-BAD/hold-*` | **Rejected** with reason `INVALID_TIMING`: negative, `1.5`, `NaN`, `"600"`, missing, 6001. **Accepted:** 0 and 6000 (R9). William's "negative/non-integer ticks" (§8.2) applies to the only stored time field. Absolute ticks are derived at load (T30) | 02 |
| **MDB-T06** | Movement count and ordering | unit | `FX-BAD/movements-*`, `FX-WILLIAM-S4` | **Rejected:** 0 or 17 movements (R8); any `startTick`, `transitionTicks`, `version`, `origin` or `droneId` (reason `RUNTIME_FIELD`; MCR-04, MCR-06); `FX-WILLIAM-S4`. **Accepted:** 1 and 16 movements. Array order is play order, so William's "unsorted/overlapping movements" (§8.2) cannot be stored. Its runtime form, strictly increasing derived ticks, is tested in T30 | 02 |
| **MDB-T07** | Document fields and keys | unit | Field cases from the canonical document model | `title` trimmed, 1–80 code points, with no `\p{Cc}`/`\p{Cf}` (as `--name`, `commands.ts:355`). `prompt` 0–2000 code points. `source` ∈ {`gemini`, `manual`}, with `generator` required exactly when `source` is `gemini`. Unknown keys rejected at any depth, as are keys starting with `$` or containing `.`, and `__proto__`/`constructor`/`prototype`, leaving `Object.prototype` unchanged. Telemetry, `RunRecord`, experiment-catalogue and superseded Gemini fields (`formationId`, `droneCount`…) are unknown keys (spec §15–§16). Client-sent `_id`, `contentHash`, `createdAt` and `updatedAt` are never stored as sent | 02 |
| **MDB-T08** | Trial expansion | unit | Every accepted fixture, at the app's `n0` and at its smallest and largest | Every accepted movement expands to exactly `n0` slots. Across the fixture corpus and a property-based sweep of text and palettes, no input passes the validator and is then rejected by `expandRecipe`. The gateway runs the same trial expansion (R14) on write and on read, so service-side validation is complete (XI-2) | 02 |
| **MDB-T09** | One validator, four call sites | unit | The corpus through all four call sites (§3.1), plus the optional `$jsonSchema` collection validator | Same verdict and reason everywhere. The `$jsonSchema` accepts every accepted fixture and rejects every shape-only failure. The module imports no DOM, `three` or network code, transitively (scanned as in `tests/boundaries.test.ts`). The gateway imports from `src/` only XI-2's pure modules: `src/contracts`, `src/score`, `src/telemetry` (#142), the P2-WP-30 validator ([boundaries §3.1](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md#31-path-from-file-to-swarm), provisional: depends on #110) and an extracted canonical-JSON helper; never `src/agent`, `src/sim`, `src/observer` or `src/cli` | 02 |
| **MDB-T10** | Schema compatibility | unit | `FX-V0`, `FX-V2`; composition `v` 0 and 2 | Missing or 0 is invalid; a newer `schemaVersion` gives `SCHEMA_VERSION_UNSUPPORTED` (spec §7.4). Neither is ever injected, and a newer version is never down-read (William §9F). A migration (not MVP) re-validates its output and never rewrites without a backup | 02 |

### 3.2 API and repository with mocked data access (T11–T18)

Integration tests run in process against `FakeShowsRepository`, with no network. The routes and statuses are William's (§5), plus MD-8's additions. Every error uses the one gateway envelope, `{ error: { code, message, details?: [{ path, reason }], requestId? } }`: `code` from the gateway's shared list, module-specific reasons only in `details[].reason`. The canonical spec owns the mapping.

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T11** | Create | integration | `POST /api/shows` with `FX-SHOW` and a fresh `Idempotency-Key` | `201` with `{ show, idempotentReplay: false }` and `Location: /api/shows/<id>`. The repository receives a document **built field by field**: `schemaVersion` 1, a server-computed `contentHash`, server timestamps, and `operationId` taken from the key. The body is never spread into the document | 04 |
| **MDB-T12** | Invalid input | integration | Each `FX-BAD/*`; malformed JSON; an array or string body; `text/plain` | `400` `VALIDATION_FAILED` (not 422: spec §10.2), with `details[]` naming each path and reason. Malformed JSON gives `400` (reason `INVALID_JSON`), and the wrong content type gives `415` `UNSUPPORTED_MEDIA_TYPE`. The repository is **never called** | 04 |
| **MDB-T13** | Oversized requests | integration | 64 KiB + 1 byte, sized and streamed without `Content-Length`; 81-character title; 2001-character prompt; 17 movements | Over 64 KiB (the `schemaVersion` 1 cap): `413` `PAYLOAD_TOO_LARGE`, with reading stopped at the limit plus one chunk and the repository not called. Field violations: `400` `VALIDATION_FAILED`. A valid body just under the limit is accepted | 04 |
| **MDB-T14** | List and pagination | integration | 60 documents, including ties on `createdAt` | `GET /api/shows` returns `{ items, nextCursor }` of `ShowSummary` metadata only (spec §10.1), with no `composition` and no `prompt`. Order is `(createdAt desc, _id desc)`. `limit` defaults to 20 with a maximum of 50. A cursor walk returns every document exactly once, ties included. A tampered cursor gives `400` `VALIDATION_FAILED` (reason `INVALID_CURSOR`). An empty library gives `200` with `items: []` and `nextCursor: null` | 03, 04 |
| **MDB-T15** | Malformed and missing ids | integration | `abc`; 23 or 25 hex characters; 24 non-hex characters; a 12-character string; `%24ne`; an encoded `{"$ne":null}`; empty; then a valid but absent id | Malformed ids give `400` `VALIDATION_FAILED` (reason `INVALID_ID`) **before** the repository is called. The check is `^[0-9a-f]{24}$`, not a driver helper that may also accept 12-byte strings (UNVERIFIED; the regex makes it moot). An absent id gives `404` `NOT_FOUND` | 04 |
| **MDB-T16** | Retrieve, validated on read | integration | The fake returns `FX-SHOW`, then each `FX-CORRUPT/*` and an `FX-V2` document | A valid document gives `200` `{ show }`. Each corrupt one, trial expansion included, gives `500` `INTERNAL` (reason `STORED_SHOW_INVALID`), and `FX-V2` gives `500` `SCHEMA_VERSION_UNSUPPORTED`; never `200` with the payload. The app-side read validator rejects the same documents (William §9B) | 03, 04 |
| **MDB-T17** | Database unavailable | integration | The fake set to `unavailable`, `timeout` (never resolves) and `throw` | `unavailable` gives `503` with code `DATABASE_UNAVAILABLE`, William's message text ("Saved shows are temporarily unavailable"), and otherwise exactly the XI-3 envelope (the client `requestId` echoed if sent; no other keys). `timeout` gives `503` within `serverSelectionTimeoutMS` (3000 ms planned; driver default 30 000 ms, VERIFIED, [Node driver connection options](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/), 2026-11-15), with `maxTimeMS` on reads. `throw` gives `500` `INTERNAL`. Health reports `modules.shows.db: "down"` | 03, 04 |
| **MDB-T18** | Connection lifecycle and module independence | integration | An instrumented `MongoClient` factory; with and without `MONGODB_URI`; the `gemini` and `tiger` modules on and off | One lazily created client per process (the factory is called once across 100 requests, and not at start-up). Without a URI, health reports `modules.shows.db: "disabled"` and the shows routes give `503` `DATABASE_UNAVAILABLE` (reason `MODULE_DISABLED`, spec §10.1, §10.6). No module's absence or failure disables another, the app, the simulator, the CLI or `report.ts` (MCR-07). Health never echoes configuration | 03, 04 |

### 3.3 Idempotency, write protection, limits and secrets (T19–T24)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T19** | Duplicate retries | integration | The fake with a unique `operationId`; the app client with a fake transport | Same key and content: `201`, then `200` with the same `id` and `idempotentReplay: true`; one document. Same key, different content: `409` `CONFLICT` (reason `IDEMPOTENCY_CONFLICT`). Two concurrent identical requests: one `201`, one `200`, one document. Missing, non-UUID or disagreeing header/body keys: `400` `VALIDATION_FAILED` (reason `INVALID_IDEMPOTENCY_KEY`). **Client:** one key per Save attempt, kept until a definitive answer; a timeout after a server-side insert, then a retry, ends in success, not a duplicate (William §9C) | 04, 05 |
| **MDB-T20** | Write protection (local MVP) | security | Default configuration | The gateway listens on `127.0.0.1` only. A `POST` with a foreign `Origin` or `Host` (spec §10.7) gets `403` `FORBIDDEN` without the repository being called (William §9D). No `Access-Control-Allow-Origin: *`. A "public" flag set without server-side authorisation stops the service from starting (MD-9, MDB-D3) | 07 |
| **MDB-T21** | Rate limiting | security | Fake clock | Writes beyond the bucket (10 per minute, burst 3; planning values, spec §10.7) get `429` `RATE_LIMITED` with `Retry-After`, and the repository sees only admitted ones. Reads have their own bucket. The limiter's state is bounded. The app shows state 6 with the draft kept | 07 |
| **MDB-T22** | Operator and markup injection | security | `{"title":{"$gt":""}}`, `$where`, dotted keys, `?limit[$gt]=1`, `?cursor[$ne]=`; titles and prompts holding `<img src=x onerror=…>`, `<script>`, `{{7*7}}` | Non-strings where strings are expected give `400`. Query values are plain strings. No client value reaches a filter other than a validated id, cursor or number. Markup is stored and returned byte for byte. **Static scan** of `ShowLibrary.ts` and the library client (`savedShows.ts`): it fails on any `innerHTML` or `outerHTML` assignment (template literal or not), an `html:` key passed to `h()` (`dom.ts:18` assigns it to `innerHTML`), `esc(` (escape-then-markup is not allowed here), `insertAdjacentHTML`, `document.write` or `srcdoc`. Stored strings reach the DOM only as `h()` text children, `textContent`, or `setAttribute` on a non-URL attribute. The house panel style (``panel.innerHTML = `…` ``, as in `Inspector.ts:191`, `Hud.ts:148`, `ControlPanel.ts:10`) is therefore a failure in these two files. **Runtime:** `<img src=x onerror=…>` as a title, a prompt and a `generator.model` renders as text in states 9 and 10 and in the list, and the panel subtree contains zero `img` and `script` elements (as [GF-T34](gemini-formation-evaluation.md#58-gateway-class-a-mode-live-gateway-only-gated-on-gf-d1), provisional: depends on #117) | 04, 05, 07 |
| **MDB-T23** | Error and log sanitisation | security | Every route × every fake failure, with `SENTINEL` credentials and captured logs | Every non-2xx body matches the gateway envelope exactly (§3.2), echoing a client `requestId` (≤ 64 characters). No success body has a `success` flag. No body or log line contains a sentinel value, `mongodb+srv`, `mongodb://`, `MongoServerError`, `E11000`, a stack frame or a file path | 04, 07 |
| **MDB-T24** | Credentials never in the client | security | `npm run build` with `SENTINEL` set in the environment; repository scan | `dist/**` contains none of `MONGODB_URI`, `MONGODB_DB`, `mongodb+srv`, `mongodb://`, the sentinel values or `MongoClient`. No `VITE_` variable other than `VITE_SIM_MODE` and the non-secret library flag appears in source or bundle. `git ls-files` lists no `.env*`. `mongodb` appears only in the gateway's own manifest. A `fetch(` scan alone is not valid ([GF-T32](gemini-formation-evaluation.md#58-gateway-class-a-mode-live-gateway-only-gated-on-gf-d1), provisional: depends on #117) | 07 |

### 3.4 User interface states (T25–T29)

These run headless with `fakeDom.ts` and a fake library client. The ten states 1–10 (William's eight, §7, plus *off* and *saving*), with their behaviour and fixed messages, are canonical in [spec §12](../integrations/mongodb-atlas-show-library.md#12-ui-workflow-md-12). In every state the simulation tick keeps advancing.

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T25** | States 1–2; registration | UI | Library flag off (the default build); then flag on with health outcomes: network error, `404`, `200` `text/html` (whether `vite preview` answers unknown paths with `index.html` is UNVERIFIED; tested either way), `modules.shows.db: "disabled"`; then a slow list | Flag off: state 1 and **zero** requests. Flag on: anything other than well-formed health JSON with `shows` enabled gives state 1 or 7 (spec §14 G), with bounded retries and no console error. A slow list gives state 2. The panel registers as spec §12 says, with no edit to `main.ts` or the shell files #113 owns | 05 |
| **MDB-T26** | States 3 and 9 | UI | An empty list, then a one-item list | State 3, then state 9 on selection, with title and movement count. Load stays disabled until retrieval and read-validation succeed | 05 |
| **MDB-T27** | States 4 and 5 | UI | A Composer draft that passes `validateDraft`, and one that fails | Save is enabled only for a passing draft, or for a validated generated draft (GF-WP-10, provisional: depends on #117). A double click sends one request. `201` and a replayed `200` both give state 5. The draft list is unchanged | 05 |
| **MDB-T28** | States 6 and 7 | UI | The fake client returns a timeout, `500`, `503`, `429` or a network error | Each gives state 6 or 7. The draft deep-equals its value before the attempt (William §7, §9A). Retry reuses the key. No event enters the controller's log, and the tick advances | 05 |
| **MDB-T29** | States 8 and 10 | UI | The fake client returns each `FX-CORRUPT/*`, then `FX-SHOW` | Corrupt documents give state 8 with a reason and **zero** `encore:control` intents. `FX-SHOW` gives state 10 with N = 3 and exactly T30's intents. A refresh clears panel state and lists again from the service (William §7) | 05, 06 |

### 3.5 Operator pathway, versions, determinism and isolation (T30–T33)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T30** | Load through the existing operator pathway | e2e | Headless app worlds (as `tests/app/actions/composition.test.ts`); real `composeNext`; one selected live drone; `FX-SHOW` | Exactly `movementCount` `inject` intents to the selected drone, and nothing else (no target assignment, no world or brain call). `t_1` is the chosen `at`, or `now + 1`; `t_{i+1} = t_i + max(scoreLead, T_i + h_i)`, with `T_i` the step's measured `transitionTicks` ([spec §8.2](../integrations/mongodb-atlas-show-library.md#82-the-load-algorithm)), so ticks strictly increase and each hold lasts exactly `h_i`. **Chaining:** score i+1's `movements[0]` equals score i's new movement, both pre-scheduled and with the recommended just-in-time runner (MDB-D6). The only gateway input is a validated candidate composition (X-RUN/live and X-PERSIST, provisional, #110). A multi-movement `composeShow` would be MDB-CC-01 (**PROPOSED CONTRACT CHANGE — REQUIRES ARNAV APPROVAL**, deferred) | 06 |
| **MDB-T31** | Fresh runtime versions; none stored | e2e + unit | T30's run; the stored document; `FX-WILLIAM-S4` | Each `INJECT_SCORE` has `score.version` = `{ issuedTick: event.tick, origin: <selected drone id> }` from `composeNext`, strictly increasing. The stored document and API response hold no `version`, `issuedTick`, `origin`, `startTick` or `transitionTicks` at any depth. `FX-WILLIAM-S4` is rejected (MCR-04, MCR-06). **Missed step:** a group cut off by a partition for step k alone adopts step k+1, which carries the then-current movement. After `PARTITION_OFF`, every live drone holds the newest version, as in base [T16](evaluation-and-tests.md#6-automated-tests) | 06 |
| **MDB-T32** | Determinism with a fixture composition | e2e | `FX-SHOW` from a **file**, with no service and no database; seed 101; a fixed event log and fixed injection ticks | Two runs give equal `stateHash()` every 100 ticks, and another seed differs (the base T04 method). The app's event log replayed headless gives the same hash (the base T13 method). Delivered through the fake client, the same composition gives a deep-equal `EnvEvent` list. Saving is **not** a replay: seed, events, params and git revision are not stored (MD-14, William §8.4) | 06 |
| **MDB-T33** | Agent isolation; existing injection unchanged | unit + security | `tests/boundaries.test.ts` extended; the base suite; `git diff origin/main` | Base T01–T05 are green. Nothing in `src/{contracts,score,agent,sim,observer}` imports the library client, the gateway, `mongodb` or `integrations/`. Only one allow-listed client module in `src/app` uses a network API (P2-T35's scan amended under MDB-D1; MCR-17). No library call runs inside the tick loop or a decision path (a fake client that throws during `world.step` never fires); its data reaches a drone only via an operator `INJECT_SCORE` (I7). There is no diff in those four core folders unless an `MDB-CC-*` is approved. `tests/app/actions/composition.test.ts` and `tests/app/composer/inject.test.ts` pass **unedited**. A one-recipe Composer injection gives the same `EnvEvent` as before (FR-34) | 02, 06, 07 |

### 3.6 Offline and networking off (T34–T36, T41)

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T34** | Server-independent build | e2e | A clean clone; `npm ci` (the one online step NFR-04 allows); then networking off, no `MONGODB_*`, and the service folder removed | `npm run build` and `bash scripts/check.sh` pass. The root `npm ci` installs none of the service's dependencies (mirrors [P2-T35](PHASE2_EVALUATION.md#7-tests-p2-t01p2-t36), provisional: depends on #110). Covers William: "Production build does not require Atlas at build time" | 03, 08 |
| **MDB-T35** | NFR-04 acceptance still passes | e2e | Networking physically off; the default build (library flag off), `npm run build && npm run preview`; a browser network log | The demo serves and runs. The default build makes **zero** external requests and none to `/api` ([NFR-04](../specification/requirements.md#3-non-functional-requirements), acceptance check unchanged). The panel sits in state 1. The scripted demo's `stateHash` is unchanged. A show held only in Atlas is unavailable, and the UI says so (William §7, MCR-09); the file path is T41 | 05, 08 |
| **MDB-T36** | Outage in mid-show | e2e | The service up (the fake repository is enough) and `FX-SHOW` loaded; then the service is stopped, or the fake switched to `unavailable`, with injections still pending | The scheduled injections fire on time, and the simulation and controls continue. The panel moves to state 7, or to state 1 if the service is gone. Retries are bounded with backoff. No event is added or lost (William §9A, §9E). The live variant is §5 step 10 | 05, 06 |
| **MDB-T41** | Offline export and import (MDB-FR-11) | unit + e2e | `FX-SHOW` and every `FX-BAD/*` as files; networking off; no gateway; an oversized and a `__proto__` file | Export then import gives the same canonical composition and `contentHash`. Import applies X-IN's 64 KiB gate and the same validator, with T01–T10's verdicts and reasons. An imported `FX-SHOW` loads through T30's path and flies, with zero requests | 09 |

### 3.7 Live Atlas integration and acceptance (T37–T40)

Until these have run, the feature may be described only as "designed and tested against a mock".

| ID | Test | Level | Setup | Pass condition | WP |
|---|---|---|---|---|---|
| **MDB-T37** | Least privilege and indexes | live | The §4 runtime and set-up principals and database | **Runtime principal:** `insert` and `find` on `encore_test.saved_shows` succeed. On `saved_shows` itself, `updateOne`, `deleteOne`, `drop`, `createIndex` and `collMod` fail; so do any write to another collection in `encore_test`, any write to another database, and `dropDatabase`. Each failure is an authorisation error that never reaches the client. **Set-up script** (set-up principal), run twice: leaves exactly `{ createdAt: -1, _id: -1 }` and a unique `{ operationId: 1 }`, plus the `$jsonSchema` validator if enabled, under which an invalid document inserted directly is rejected. **Missing indexes:** with the unique index dropped, the service's first connection (`listIndexes`) reports `modules.shows.db: "down"` and creates nothing | 03, 08 |
| **MDB-T38** | Read-after-write | live | The service writes to `encore_test`; a **second, independent** `MongoClient` reads back | After `POST` `FX-SHOW`: `_id` is an ObjectId, the timestamps are BSON Dates, and the stored `composition` deep-equals the input with its recomputed hash equal to `contentHash`. The test records `schemaVersion`'s stored type, int32 or double (serialiser choice UNVERIFIED; the schema must accept it). `GET /:id` returns the same document, and the list shows it first | 03, 04, 08 |
| **MDB-T39** | Live idempotency and failure | live | The real unique index; then an unreachable database (access-list entry removed, network off, or an unroutable host) | Two concurrent `POST`s with one key leave `countDocuments({ operationId }) = 1`, with one `201` and one `200`. Different content gives `409`. The real duplicate-key error (code 11000, UNVERIFIED) maps to replay, never `500`. An unreachable database gives `503` within the deadline, with a sanitised body | 04, 08 |
| **MDB-T40** | Ten-step acceptance | live | §5 | All ten steps on one commit, with every evidence item | 08 |

---

## 4. Database testing setup

- **Unit and integration:** the fake repository only. No driver connection, no network.
- **Live:** a separate database, for example `encore_test`, never the demo's `MONGODB_DB=encore`.
- **Two principals.** Database-level `readWrite` is not acceptable: it grants update, remove and drop on every collection, and the MVP is append-only.
  - **Runtime:** the service's user holds only a custom role with `find`, `insert` and `listIndexes` on `encore_test.saved_shows` (no update, remove, drop, `createIndex` or `collMod`; collection scoping on the Atlas tier in use is UNVERIFIED, spec §27 item 4, and T37 checks it). On first connection the service verifies the §11 indexes with `listIndexes` and reports `db: "down"` if they are missing; it never creates them.
  - **Set-up:** a separate admin user runs a one-off set-up script that creates the indexes and the optional `$jsonSchema` validator (`collMod`). It is never in the service's environment.
  - Both have a network access list restricted to the tester's address, with credentials only in the runner's environment (`MONGODB_TEST_URI`, `MONGODB_TEST_DB`; the set-up URI separately).
- **Clean per run:** each run prefixes its `operationId`s with a `runId`. In `afterAll`, including after a failure, the set-up principal (the runtime one cannot delete) deletes what the run created and sweeps stale runs older than 24 h, then records that zero of its documents remain.
- **Never in CI:** neither CI nor `scripts/check.sh` sets the test environment. Live latency is an observation, never a target. Quotas and cost depend on the Atlas plan (William §8.4).

---

## 5. Live end-to-end acceptance (MDB-T40)

William's ten steps (§10), with their intent unchanged. Step 2 depends on the Gemini path. Before GF-CC-01 the only substitute is a Composer draft, stored as `source: manual` and **reported as such** (MDB-D7); a `generated` recipe cannot be stored in `schemaVersion` 1 (spec §7.5). After GF-CC-01, an offline-authored scene (OFFLINE-AUTHORING, GF-WP-09; provisional: depends on #117) is saved as `schemaVersion` 2 with `source: gemini` and a `generator` (the authoring tool's model id), never as `manual` (spec §7.1, §7.2). A manual run does not demonstrate "generated with Gemini, saved to Atlas".

| Step | Action | Evidence to capture |
|---|---|---|
| 1 | Start the app with the library flag on and the gateway on `127.0.0.1`, Atlas configured | Commit hash; `/api/health` showing `modules.shows.db: "up"`; a start-up log free of secrets |
| 2 | Generate a valid composition with Gemini (or the declared manual substitute) | Prompt, model id and `integrationVersion`, or "manual"; the validator's verdict |
| 3 | Save the show | The `201` `id` and `contentHash`; a screenshot of state 5 |
| 4 | Verify the document exists in Atlas | **Either** an Atlas Data Explorer screenshot of the document, with connection details cropped, **or** a driver read-after-write log from a separate client (the T38 method) showing `_id`, `title`, `contentHash` and `createdAt` |
| 5 | Refresh the browser | Panel state cleared, list fetched again |
| 6 | Open Saved Shows | The list with the show first |
| 7 | Retrieve the same show | `title` and `contentHash` equal to step 3's and to the app's recomputed hash; state 9 |
| 8 | Load through the operator pathway | State 10; N `INJECT_SCORE` events in the console or event log, each `{ issuedTick: tick, origin: <drone> }`; the new versions visible in the belief/version colour mode |
| 9 | Execute the formations | The sequence in order (screenshots or a recording). Adoption counts read from `MetricsSample.versions`, not from the UI |
| 10 | Atlas outage while the loaded show runs | Network disabled, or the service stopped, **while injections are pending**. A recording showing later steps still firing and the panel in state 7 or 1 |

The test passes when all ten steps pass on one commit, with the evidence attached to the issue or PR. A missing evidence item fails its step. Evidence must not show a URI, password, cluster host, or any prompt that MDB-D2 makes private.

---

## 6. Coverage of William's checklist

Every item of William's §10 checklist and §12 failure list maps to a test: round-trip and save/read equivalence T01, T11, T16, T38; recipes, ordering, timing, glyphs, colours T02–T06, T12; oversized requests T13; duplicate retries T19, T39; invalid id and missing record T15; outage and timeout T17, T39; operator pathway T30, T31; determinism and isolation T32, T33; build without Atlas T34; corrupt document T16; outdated schema T10; unauthorised write T20; internet outage T35, T36.

---

## 7. Planned versus executed evidence

**No test in this file has been executed.** No code exists to run them against.

| Evidence | Tests | Status |
|---|---|---|
| Validator and serialisation | T01–T10 | Planned |
| Service against the fake repository | T11–T19 | Planned |
| Security and limits | T20–T24 | Planned |
| UI states | T25–T29 | Planned |
| Pathway, versions, determinism, isolation | T30–T33 | Planned. T30's chaining is predicted from reading `actions.ts`, not observed |
| Offline build, NFR-04, file export/import | T34–T36, T41 | Planned |
| Live Atlas and acceptance | T37–T40 | Planned. No test database or user exists |

When a test runs, its PR records the commit, date, command and result, with pre-existing failures named as such (William §10).

---

## 8. Gates

A gate opens only when every listed test passes on one commit. Gates are cumulative.

| Gate | Requires | Also requires |
|---|---|---|
| **Save button ships** (merged; inactive unless the service is detected) | T01–T19, T22–T35 | **MDB-D1**, one decision with Phase 2 D3, Gemini GF-D1 and Tiger TIG-D1 ([roadmap decisions](../planning/PHASE2_ROADMAP.md#decisions-for-arnav), provisional: depends on #110), approved by Arnav after consulting William and Haris. It scopes NFR-04 and its companion rules to the optional gateway (X-RUN/live and X-PERSIST, provisional, #110); the core and the default build stay offline (MCR-03, MCR-11). MDB-D4 settled. Base suite green, with no diff in the core folders. A Vite `/api` proxy, if used, signed off by the build-config owner |
| **Networked demo** (judged demo, video or Devpost showing the cloud library) | The gate above, plus T20, T21, T36–T40 | The §5 evidence attached. The networking-off path rehearsed (T35, plus T41 if MDB-WP-09 is built) and kept as the fallback. MDB-D2 decided (visibility, prompt storage). A demo database separate from `encore_test`. Spoken claims follow §9 |
| **Any public deployment** | All of the above, re-run in the deployed configuration | MDB-D3 built: server-side authorisation (spec §10.7), public-scale rate limits, Atlas access restricted to the server, T20 re-specified for the public origin, MDB-D2 reviewed for prompt exposure (William §8.3). Out of MVP scope (MD-9) |

---

## 9. Wording, and inconsistencies noted while writing

**Wording.** The base [rules](evaluation-and-tests.md#8-bias-risks-and-reporting-wording) apply. Say "saved to and retrieved from MongoDB Atlas" only with T38 or T40 evidence. Say "the swarm's gossip disseminates the loaded show", never "Atlas sends the show to the drones". A saved show is not a "recorded run". Do not call the library "offline-capable": only the core simulation needs no network. Do not write "never at run time": the library is used while the simulation runs, never inside the tick loop or a decision path.

**Open for the canonical spec** (reported here, resolved only where marked):

1. **Shared codes.** *Resolved* by spec §10.1–§10.3: the `400 VALIDATION_FAILED` and `409 CONFLICT` reasons are as assumed here, `STORED_SHOW_INVALID` is under `500 INTERNAL`, and `MODULE_DISABLED` is under `503 DATABASE_UNAVAILABLE` (T16, T18).
2. **XI-2** names P2-WP-30's validator; MDB-WP-02's composition module must sit inside it for T09.
3. **Registration.** *Resolved:* spec §12 and work-package §1 and MDB-WP-05 all say `createPanel`.
4. **Least privilege (§4, T37).** Spec §11 creates indexes "once at module start", §21 and MDB-WP-03 say "read and write" / `readWrite` on `saved_shows`, and §10.8 says Atlas is never contacted at gateway start. This file requires a find/insert/listIndexes runtime role, a separate admin set-up script for indexes and `$jsonSchema`, and an index check on first connection. The spec and MDB-WP-03 need aligning.
5. **Rendering (T22).** Spec §12 "Rendering" and MDB-WP-05 say only "`textContent`, never `innerHTML`". They should list the banned sinks (`h(…, { html })`, `esc()` + markup, template `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`), since `dom.ts:10-11` blesses `esc`-then-`innerHTML` and every current panel uses template `innerHTML`.
6. **Offline-authored generator (§5).** What `generator.integrationVersion` holds for an OFFLINE-AUTHORING scene, which has no gateway, is the spec's call (with #117).
