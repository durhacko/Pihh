> **Source handoff, preserved unmodified below this banner.** Author: William Pimentel (`wpimento`). Received Sun 15 Nov 2026 00:44 GMT as `Encore_MongoDB_Atlas_Implementation_Spec.md`; added to the repo by Arnav's orchestrator under issue #130. This is William's **source proposal**, not a record of implemented features and not an approved design. Its statement that Gemini and TigerData are "reported as completed" was **not** borne out by the repository at the time of integration (no such code on `main` or any pushed branch at `4c41f75`). Its section 12 brief is source material for a future coding agent, **not** permission to implement now. The canonical, reconciled specification is [`../integrations/mongodb-atlas-show-library.md`](../integrations/mongodb-atlas-show-library.md); where the two differ, its conflict records explain why. Nothing below this line has been edited.

---

# Encore × MongoDB Atlas — Implementation Specification

**Purpose:** A hackathon-scoped, genuine MongoDB Atlas integration for saving and reusing Gemini-generated drone shows, without changing Encore's decentralized simulation.

**Status:** Proposed implementation. Gemini and TigerData are reported as completed in the team's current branch; their current implementation details must be inspected before coding. The earlier uploaded `Pihh.zip` snapshot does not establish those integrations.

## 1. Executive decision

Implement **Encore Show Library**: users generate drone formations with Gemini, validate them against Encore's score contract, save them to MongoDB Atlas, browse previously saved shows, and load them into Encore without calling Gemini again.

**MVP success criterion:** Generate a show → save it to Atlas → refresh the browser → retrieve the saved show → load and execute it in Encore.

**Estimated effort:** 1–2 hours if an existing backend can be reused; not guaranteed. Set a timebox and avoid refactoring the core simulation.

MongoDB must not become a dependency of the drone simulation. Its purpose is persistence and reuse of compositions, not telemetry, agent decisions, or replay infrastructure. Prize eligibility and competitiveness are not guaranteed by merely using Atlas.

### Known repository context and verification caveat

The uploaded snapshot was described as TypeScript, Vite, Three.js, Node.js, and Vitest, with:

- `src/contracts/score.ts`: `Score`, `Movement`, and `text`, `sphere`, `helix` recipe types.
- `src/contracts/metrics.ts`: `RunRecord` and time-series metrics.
- `src/cli/main.ts`: local JSON evaluation records.
- An architecture requiring offline operation and no external services.

The snapshot reportedly did **not** contain the completed Gemini/TigerData integrations or an existing `server/` directory. The AI coding agent must inspect the **latest working branch** and not assume the older snapshot reflects current code. Preserve the existing terminology and contracts, and report discrepancies before implementing.

## 2. System architecture

```text
                    Encore browser UI
                 Generate | Save | Browse | Load
                             |
                Existing app API / local server
                       /             \
                 Gemini API       MongoDB Atlas
              Generate score      Saved shows
                       \             /
                   Local score validation
                             |
                Existing operator score pathway
                             |
                  Encore simulation core
              Local agents / physics / radio
                             |
                   TigerData telemetry
```

**Roles:**

| Component | Responsibility | Required for locally available show execution? |
|---|---|---|
| Gemini API | Generate new score from natural language | No |
| MongoDB Atlas | Persist, list, retrieve generated shows | No |
| TigerData | Store and analyze run telemetry | No |
| Encore | Validate and execute locally available scores | Yes |

The application is **cloud-assisted but simulation-offline-capable**. Gemini generation, cloud-only show retrieval, and TigerData upload all need internet. Once a valid score is available locally, the simulation should not need these services. The older absolute “no internet” architecture requirement must be updated or explicitly scoped to the core simulation.

## 3. Required end-user workflow

1. **Generate:** Operator enters a prompt such as “Start with HELLO, transition into a sphere, and finish with a double helix.” Gemini produces a candidate composition in or convertible to Encore's `Score` format.
2. **Validate:** Check recipe kinds, text character restrictions, colors, movement timings/order, and all existing score invariants. Reject invalid candidates before saving or executing.
3. **Save:** User chooses Save Show. Persist the prompt, validated composition, title, timestamp, schema version, and available generation metadata in Atlas.
4. **Browse:** Saved Shows panel lists previous shows by title, creation time, and movement count, newest first.
5. **Retrieve:** Selecting an item fetches its complete score. Validate again on read.
6. **Load:** Pass reusable composition content through the **existing operator injection pathway**, assigning a valid runtime `ScoreVersion` as needed. Do not directly manipulate individual drone targets.
7. **Run:** Encore executes the show using its existing local coordination and simulated radio behavior.

**Explicitly out of scope for MVP:** accounts, collaboration, full deterministic replays, MongoDB telemetry, vector embeddings, semantic search, advanced analytics, or a full experiment-management platform.

## 4. Data model

**Database:** `encore`  
**Collection:** `saved_shows`

Illustrative structure (actual `_id` is BSON ObjectId and dates are BSON Date values):

```json
{
  "_id": "MongoDB ObjectId",
  "schemaVersion": 1,
  "title": "HELLO to Helix",
  "prompt": "Start with HELLO, then a sphere...",
  "score": {
    "version": { "issuedTick": 0, "origin": 0 },
    "movements": [
      { "startTick": 0, "transitionTicks": 60, "recipe": { "kind": "text", "text": "HELLO" } },
      { "startTick": 200, "transitionTicks": 80, "recipe": { "kind": "sphere" } },
      { "startTick": 400, "transitionTicks": 80, "recipe": { "kind": "helix" } }
    ]
  },
  "source": "gemini",
  "generator": { "model": "actual-model-id", "integrationVersion": "1" },
  "createdAt": "BSON Date",
  "updatedAt": "BSON Date"
}
```

**Important:** This example is schematic, not a claim that these exact recipe payloads satisfy every current score invariant. Generate real documents from the existing validated types.

| Field | Type | Requirement |
|---|---|---|
| `_id` | ObjectId | Database identifier |
| `schemaVersion` | Integer | Start at 1 |
| `title` | String | Required, trimmed, length-bounded |
| `prompt` | String | Original Gemini prompt, bounded length |
| `score` | Object | Complete validated Encore score or canonical reusable composition |
| `source` | Enum | `gemini` / `manual` |
| `generator.model` | String | Actual model ID when available |
| `createdAt`, `updatedAt` | BSON Date | Backend-controlled timestamps |

### Runtime version versus reusable composition

`ScoreVersion` has `issuedTick` and `origin`, which carry simulation semantics. A stored score version must **not** be blindly injected into an active simulation. Keep saved movement/recipe content separate from runtime version assignment where practical, or strip/reassign version metadata using the existing operator pathway. Never invent a version in the persistence layer.

### Indexing and storage

```ts
await collection.createIndex({ createdAt: -1 });
```

Titles should not be unique. `_id` is already unique. For retry-safe creation, use a stable operation ID/idempotency key with a unique index if needed. MongoDB has a 16 MiB BSON document size limit: do not embed full telemetry, frame snapshots, large AI traces, or replay payloads. A normal short score should be much smaller, but enforce request size limits.

## 5. Backend and API

The browser must never hold MongoDB credentials. **Reuse the existing Gemini/TigerData backend if one exists.** Do not add Express or another framework before inspecting current infrastructure.

| Method | Endpoint | Behavior |
|---|---|---|
| `POST` | `/api/shows` | Validate and save a show |
| `GET` | `/api/shows` | Paginated list of metadata only |
| `GET` | `/api/shows/:id` | Retrieve complete saved show |
| `GET` | `/api/health` | Optional readiness check |

`GET /api/shows` should return `_id`, `title`, `source`, `createdAt`, and `movementCount` (or equivalent), not all complete scores. `GET /api/shows/:id` returns the full validated content. Editing and deletion are not required for MVP.

| Condition | HTTP status |
|---|---|
| Created | 201 |
| Retrieved | 200 |
| Malformed ID or invalid input | 400 |
| Unauthorized / forbidden write | 401 / 403 |
| Missing show | 404 |
| Atlas unavailable | 503 |
| Unexpected server failure | 500 |

Example error:

```json
{"error":{"code":"DATABASE_UNAVAILABLE","message":"Saved shows are temporarily unavailable"}}
```

**Backend requirements:**

- Official MongoDB Node.js driver; one reused connection pool / connection promise.
- Runtime schema validation for requests and retrieved documents; TypeScript casts are insufficient.
- Payload size limits, bounded pagination, valid ObjectId checks, sanitized errors.
- Trusted backend timestamps and controlled writable fields; no arbitrary client-side MongoDB operators.
- Secure write authorization and reasonable rate limiting for public deployments.
- Idempotent creation to prevent duplicate documents when a client times out after a successful insert.
- Keep database calls asynchronous and completely outside simulation ticks.

Environment variables (server only):

```dotenv
MONGODB_URI=mongodb+srv://...
MONGODB_DB=encore
```

Do not expose the URI via `VITE_` variables, client bundles, committed `.env` files, screenshots, or logs. Use a least-privilege Atlas database user and restrict network access where practical.

### Illustrative browser client

```ts
async function saveShow(input: { title: string; prompt: string; score: Score }) {
  const response = await fetch('/api/shows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Failed to save show');
  return response.json();
}
```

This is **not** sufficient by itself: the backend must independently validate, authorize, and enforce idempotency. For retry-safe creation, include an appropriate stable operation ID.

## 6. Integration boundaries and file plan

Possible new files, **subject to latest-branch inspection**:

```text
src/
  app/
    ui/ShowLibrary.ts
    services/savedShows.ts
  contracts/score.ts          # reuse existing contract
server/                       # only if no backend already exists
  db/mongo.ts
  routes/shows.ts
  validation/savedShow.ts
tests/
  persistence/savedShows.test.ts
```

**Preserve unchanged unless explicitly necessary:**

- `src/agent/` — autonomous decisions and coordination.
- `src/sim/` — physics, world, radio, simulation timing.
- `src/observer/` — observation and metrics.
- `src/cli/` — existing local evaluation outputs.
- `src/contracts/score.ts` — existing score contract.
- TigerData's telemetry integration.

**Loading flow:**

```text
Select saved show
  -> GET /api/shows/:id
  -> validate response
  -> extract reusable composition
  -> assign valid runtime score version via existing operator logic
  -> inject through existing operator pathway
  -> normal decentralized radio propagation and execution
```

Never assign individual drone targets from MongoDB. Do not bypass radio or agent decision-making.

## 7. UI specification

Add **Save Show** after successful Gemini generation and a **Saved Shows** panel near existing controls.

List entries show title, creation time, movement count, and optionally source. Selecting an entry enables a real **Load into Encore** action once retrieval and validation succeed.

Required UI states:

| State | Behavior |
|---|---|
| Loading | Spinner / clear progress indicator |
| Empty library | Friendly empty state |
| Save success | Confirmation and title |
| Save failure | Preserve generated score in memory; retry option |
| Atlas unavailable | Cloud library unavailable; local simulation unaffected |
| Invalid saved score | Reject and explain; do not inject |
| Selected saved show | Show title and movement count |
| Loaded | Existing operator controls can execute it |

A refresh should clear in-memory UI state but **not** the Atlas-backed saved library. A saved show that exists only in Atlas cannot be loaded while offline unless previously cached or exported locally.

## 8. Potential flaws, limitations, and mitigations

### 8.1 Architectural risks

| Risk | Severity | Mitigation |
|---|---|---|
| Internet unavailable | High | Cloud features fail gracefully; locally available simulation continues |
| Backend unavailable | High | Do not block generated score already in memory |
| Atlas credentials exposed | Critical | Credentials only on trusted server |
| Database I/O slows simulation | High | No DB calls inside ticks or agents |
| Saved score bypasses radio | Critical | Reuse operator score pathway |
| TigerData overlap | Medium | MongoDB for shows; TigerData for telemetry |
| Backend breaks static deployment | High | Preserve local preview and production build; document server deployment |
| New packages break CI | Medium | Run full checks |

### 8.2 Data integrity risks

| Risk | Impact | Mitigation |
|---|---|---|
| Unsupported Gemini recipe | Invalid execution | Strict runtime validation |
| Unsupported text glyphs | Incorrect formation | Existing font restrictions |
| Overlapping/unsorted movements | Bad scheduling | Existing score invariants |
| Negative/non-integer ticks | Invalid timing | Validate numeric fields |
| Invalid RGB values | Rendering/contract errors | Validate against actual contract |
| Oversized payload | Resource exhaustion | Limit prompt, movements, body size |
| Old schema retrieved | Compatibility failure | Versioned documents and readers/migrations |
| Duplicate retries | Duplicate shows | Stable idempotency key |
| Stale stored ScoreVersion | Rejection/incorrect ordering | Assign runtime version via operator |

Both Gemini responses and MongoDB documents must be validated as untrusted input, including on read.

### 8.3 Security risks

- **Credential leakage:** Never put `MONGODB_URI` in browser code or Vite public environment variables.
- **Unauthorized writes:** Public `POST /api/shows` needs server-side authorization. A shared secret in browser JS is not protection.
- **Denial of service:** Request-body limits, rate limiting, and bounded list pagination.
- **Stored content injection:** Render saved titles/prompts as text, never unsanitized HTML.
- **Prompt privacy:** A publicly readable library may expose user-entered prompts; make visibility intentional and clear.
- **Atlas network permissions:** Use restrictive IP/network settings where possible and a least-privilege database account.
- **Error disclosure:** Never leak secrets, raw stack traces, or connection strings to clients.

### 8.4 Operational and product limitations

- Cloud save/retrieve requires connectivity and can be slower than local JSON.
- Atlas quotas, costs, and performance depend on the actual plan and cluster configuration.
- Successful persistence does not prove the show executes correctly; validate and test through the operator pathway.
- Save may succeed while the client times out; retries must be idempotent.
- Schema evolution needs compatibility handling.
- Offline access to cloud-only shows requires separate caching/export functionality, not included in MVP.
- Saving a score is **not** saving a deterministic replay. Full replay needs configuration, seed, events, environment, and verification.
- A basic save/load integration is technically valid but may be less compelling to judges than deeper MongoDB use. Prize eligibility and outcome must be verified separately.
- If the existing Gemini integration has no trusted backend, introducing one may take materially longer than the 1–2 hour target.

## 9. Failure handling scenarios

**A. Atlas unavailable during save:** Keep the Gemini-generated valid score in memory, show an error, allow retry, do not interrupt simulation.

**B. Corrupt saved document:** Reject on retrieval, do not inject, show a validation error.

**C. Save request times out:** Server may have inserted successfully; retry with the same idempotency key to avoid duplicates.

**D. Unauthorized write:** Reject before insertion, no credential disclosure.

**E. Internet entirely unavailable:** Gemini generation, cloud library, and TigerData cloud operations are unavailable, but existing local controls and locally available shows continue.

**F. Outdated saved schema:** Either migrate safely or report incompatibility; never silently reinterpret a score with changed semantics.

## 10. Testing and acceptance criteria

### Automated tests

- [ ] Valid `Score` round-trips through serialization and retrieval without losing movements.
- [ ] Unsupported recipe kinds rejected.
- [ ] Invalid ordering, timing, tick values, text glyphs, and colors rejected per existing contract.
- [ ] Oversized requests rejected.
- [ ] Save/read returns equivalent score content.
- [ ] Duplicate retries create only one document.
- [ ] Invalid MongoDB IDs return 400.
- [ ] Missing records return 404.
- [ ] Database outage returns controlled error.
- [ ] Saved show loading uses existing operator pathway.
- [ ] Existing simulation, determinism, and isolation tests pass.
- [ ] Production build does not require Atlas at build time.

Mock the repository/data-access interface for unit tests. Use a separate test database for real integration tests.

### End-to-end acceptance test

1. Start application with Atlas configured.
2. Generate a valid score using Gemini.
3. Save the score.
4. Verify its document exists in Atlas.
5. Refresh the browser.
6. Open Saved Shows.
7. Retrieve the same show.
8. Load through the existing operator pathway.
9. Execute the intended formations.
10. Verify an Atlas outage does not prevent an already loaded local show from running.

Run `npm run check` if still defined in the current branch; otherwise use its equivalent. Record executed tests and results, including pre-existing failures. Do not claim live Atlas verification without an actual read-after-write test.

## 11. Implementation sequence for AI coding agent

| Phase | Task | Exit condition |
|---|---|---|
| 1. Inspect | Locate current Gemini/TigerData integrations, backend, score validator, operator injection | Actual architecture understood |
| 2. Design | Confirm document schema and API conventions | No duplicate infrastructure |
| 3. Persist | Driver, connection reuse, validation, repository, indexes | Save/retrieve work |
| 4. Integrate | Connect real Gemini output and operator load | Real score executes |
| 5. UI | Save button and Saved Shows panel | Full browser flow |
| 6. Harden | Authorization, retries, failure states | Negative tests pass |
| 7. Verify | Checks and live Atlas end-to-end test | No core regressions |

**Stop/reassess** if a major refactor of the simulation, agent interfaces, Gemini, or TigerData is required. This is a persistence extension, not a redesign.

## 12. Copy-paste AI coding agent brief

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

## 13. Final scope recommendation

**Build:** MongoDB-backed storage and retrieval of Gemini-generated compositions.  
**Reuse:** Existing Gemini integration, backend if available, score contracts, and operator interface.  
**Avoid:** Full replay infrastructure, duplicate TigerData storage, MongoDB in simulation logic, unnecessary backend rewrites.

**Value proposition:** A Gemini-generated show becomes a reusable persistent asset rather than a one-time generation. The principal remaining trade-offs are backend compatibility, security, data validation, implementation time, and uncertain prize competitiveness.
