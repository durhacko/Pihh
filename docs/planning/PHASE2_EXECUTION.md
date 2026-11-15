# Phase 2 execution record

> **STATUS: DEVELOPMENT QUEUED — NO PHASE 2 IMPLEMENTATION MERGED.**
> Created 15 November 2026 after Phase 1 release freeze. This is a short operational register, not a replacement for the canonical specifications.

## Immutable baseline and active branches

| Item | Reference | Policy |
|---|---|---|
| Phase 1 release | `458f1b17323b73f808a46ec397b125980cf6dfda` | Keep immutable |
| Phase 1 checkpoint | `checkpoint/phase1-complete-2026-11-15` | Permanent fallback |
| Frozen evidence | `0b2f8f3`, #190 | Never overwrite historical records |
| Phase 1 release record | [CURRENT_STATE](../CURRENT_STATE.md) | Do not change until G6 |
| Phase 2 integration | `phase2/development` | All Phase 2 work targets here, not `main` |
| Master coordination | [#199](https://github.com/durhacko/Pihh/issues/199) | Owners/PRs/gates |

Phase 1 engineering G0–G5 is complete and browser-smoke tested; G6 (Devpost submission) is still human-owned and was not confirmed at this kickoff. **No Phase 2 code may merge into `main` or replace the judged-demo build before G6.** The Track H 04:00 latest start was missed; its 07:30 close is not a licence to bypass the submission gate. Agents may begin isolated implementation and tests, with no claim that new features will be judged.

## Active implementation queue

**Arnav's instruction (about 07:40–07:55 GMT, relayed in the [#199 checkpoint at 07:42](https://github.com/durhacko/Pihh/issues/199#issuecomment-6891191211)):** "maximise parallel lanes; D1, D2, D3 queued; D3 sequential Gemini → MongoDB → TigerData".

Lanes and file locks, as posted on #199 at 07:42 (one owner per file; nothing outside the lock). PR heads were checked when this table was written.

| Issue | Work package | Owner | Branch | Locked files | Depends on | State / PR |
|---|---|---|---|---|---|---|
| [#200](https://github.com/durhacko/Pihh/issues/200) | P2-WP-01 invariant checker | durhack-5b | `phase2/200-invariant-checker` | `src/observer/invariants.ts`, `src/cli/harness.ts`, tests | Base | In review: PR [#222](https://github.com/durhacko/Pihh/pull/222) (`55bd195`) |
| [#201](https://github.com/durhacko/Pihh/issues/201) | P2-WP-04 score linter | durhack-77 | `phase2/201-score-linter` | `src/cli/lint.ts`, `src/cli/lintReport.ts`, tests | Base | Merged: PR [#210](https://github.com/durhacko/Pihh/pull/210) (merge `5cff677`) |
| [#202](https://github.com/durhacko/Pihh/issues/202) | P2-WP-03 repair-cascade trail | durhack-18 | `phase2/202-repair-cascade` | `render/layers/CascadeLayer.ts`, `render/colourModes/cascadeTrail.ts`, tests | Base | Merged: PR [#204](https://github.com/durhacko/Pihh/pull/204) (merge `36e2600`) |
| [#203](https://github.com/durhacko/Pihh/issues/203) | GF-WP-01 SceneSpec validation (no API) | durhack-48 | `phase2/203-gemini-scene-validation` | `src/score/generated/` schema and validation files, fixtures | Base | Building |
| [#221](https://github.com/durhacko/Pihh/issues/221) | XI-7 canonicalJson extraction | durhack-0c | `phase2/xi7-canonical-json` | `src/score/canonical.ts`, `src/cli/run.ts` (import only), test | Base | Building |
| [#206](https://github.com/durhacko/Pihh/issues/206) | GF-WP-03 2D shapes and mask | durhack-01 | `phase2/gf-03-shapes2d` | `src/score/generated/shapes2d.ts`, test | #203 (adapter) | Building (draft; adapter after #203) |
| [#208](https://github.com/durhacko/Pihh/issues/208) | P2-WP-05 Composer lint warnings | durhack-d1 | `phase2/p2-05-composer-lint` (stacked on #210) | `src/app/ui/Composer.ts`, `draftLint.ts`, test | #201 | Building (draft) |
| [#217](https://github.com/durhacko/Pihh/issues/217) | P2-WP-09 inspector peer diff (D1 exception) | durhack-77 | `phase2/p2-09-peer-diff` | `src/app/ui/peerDiff.ts`, `Inspector.ts` hook, `inspectorTruth.ts` hook, test | D1 | Building |
| [#211](https://github.com/durhacko/Pihh/issues/211) | GF-WP-05 3D shapes | durhack-18 | `phase2/gf-05-shapes3d` | §GF-WP-05 files only | #204 tweak | Next for this owner |
| [#209](https://github.com/durhacko/Pihh/issues/209) | P2-WP-06 live invariant legend | durhack-98 (684fea) | `phase2/p2-06-invariants-legend` | `render/layers/InvariantsLayer.ts`, test | #200 (P2-T02 clean) | Waiting |
| [#205](https://github.com/durhacko/Pihh/issues/205) | GF-WP-02 hashing and seeded PRNG | durhack-0c | `phase2/gf-02-hashing` | `src/score/generated/hashing.ts`, `prng.ts`, test | #203, #221 | Waiting |
| [#207](https://github.com/durhacko/Pihh/issues/207) | GF-WP-04 2D sampling | durhack-01 | `phase2/gf-04-sample2d` | `src/score/generated/sample2d.ts`, test | #205, #206 | Waiting |
| Workstream E | Register and per-PR handoff checks | durhack-fe | — | This queue table only | — | Per-PR checks |

**Queued, gated in dependency order:**
- [#212](https://github.com/durhacko/Pihh/issues/212) GF-WP-06 compiler → [#213](https://github.com/durhacko/Pihh/issues/213) GF-WP-10 Composer generated tab → [#214](https://github.com/durhacko/Pihh/issues/214) GF-WP-11 injection and provenance.
- D2: [#215](https://github.com/durhacko/Pihh/issues/215) [contract] GF-WP-07 generated recipe integration.
- D3, **strictly sequential**: [#218](https://github.com/durhacko/Pihh/issues/218) #1 Gemini live → [#219](https://github.com/durhacko/Pihh/issues/219) #2 MongoDB Atlas → [#220](https://github.com/durhacko/Pihh/issues/220) #3 TigerData.
- [#216](https://github.com/durhacko/Pihh/issues/216) Track P animated choreography (D2, after G6).

The merge order follows the dependencies, only the orchestrator merges, and each merged branch and its worktree are retired.

**Owners and file locks are in the queue table above, mirroring #199.** The lead orchestrator must claim each issue and reserve the exact allowed-file set before an agent begins. Each agent works from an independent branch/worktree based on `phase2/development`, makes one small PR targeting that branch, and reports measured checks. Do not let agents merge their own PRs without coordinator review.

## Architecture and acceptance

These are authoritative; never create parallel competing specifications:

- [Phase 2 roadmap](PHASE2_ROADMAP.md): Track H / Track P, gates P2-G0–G6, decisions D1–D7.
- [Work packages](../development/PHASE2_WORK_PACKAGES.md): implementation steps, allowed files, PR sequencing.
- [Evaluation](../validation/PHASE2_EVALUATION.md): P2-T01–T36, fixed thresholds, regression rules, result provenance.
- [Phase 2 architecture](../design/PHASE2_ARCHITECTURE.md) and [integration boundaries](../design/OPTIONAL_INTEGRATION_BOUNDARIES.md): the offline core invariant.
- [Gemini](gemini-integration-work-packages.md), [MongoDB](mongodb-integration-work-packages.md), [Tiger Data](tiger-data-integration-work-packages.md): provider-specific canonical work packages; these are proposals, not existing runtime features.

### Non-negotiable gates

1. **Offline first.** No network requests, cloud services, keys, telemetry upload or live gateway in the default build or swarm tick loop. Gemini's first package is only pure validation, not an API integration.
2. **D2 and D3 remain unapproved.** Starting offline, contract-free implementation does not approve changing `src/contracts/**`, NFR-04 or AGENTS.md. A separate human decision is needed **for each** networked sponsor module. Do not treat the mere existence of the docs as an implementation licence.
3. **Determinism and truth.** Check the correct baseline `stateHash` and `summary` for the same seed/events; observer or X-ray may read history but must not affect agent decisions. Fake or fabricated peer knowledge is prohibited.
4. **Evidence provenance.** Keep prior `results/` frozen. Any future simulation/contract change that affects evaluation is a new tagged revision with a fresh matrix and explicitly labelled comparisons (roadmap D5), never a replacement of `0b2f8f3`.
5. **Truthful metrics.** The documented S5 median collision cost (103 vs 14 for the 5-seed baseline, not like-for-like) stays visible; nPWC's priority labels are project-defined, and coverage ties.
6. **Tests are proof, not assertions.** Targeted P2-Txx plus `bash scripts/check.sh` for each PR; record the actual output. Browser/manual rehearsal is required for C2 before any public-demo inclusion, and the opt-out path must stay identical to Phase 1.

## Sponsor sequencing after an explicit D3 decision

- **Gemini:** GF-WP-01 schema/validator first; GF-WP-02 canonical hashing, then deterministic geometry compiler and operator preview. Only later a separate opt-in model gateway.
- **MongoDB Atlas:** MDB-WP-01 verification; MDB-WP-02 shared offline SavedShowComposition validation after its listed dependencies; gateway, database and HTTP only after module-specific D3.
- **Tiger Data:** TIG-01 verification; TIG-02 offline record validation/identity after canonical extraction; imported evidence and analytics only after the appropriate decisions. No synthetic numbers passed off as experiment results.
- One optional shared gateway only; modules never write into or control the distributed decision loop.

## Next coordinator checkpoint

Report only: work package → branch → owner → current SHA → tests → PR → blockers. Stop optional work if it contends with the presenter laptop or Devpost G6. After confirmed submission, decide whether to merge clean Phase 2 PRs into `phase2/development` and start Track P contract reviews in the documented dependency order. No broad architectural redrafting is needed.

## Sprint 0 — readiness and clean boundaries (15 November 2026)

**Purpose:** make the Phase 2 implementation queue easy to execute while G6 is still pending. This is not a new architecture or permission to alter the frozen release.

| Workstream | Owner | State / exit condition |
|---|---|---|
| Phase 1 / submission | Human team; #8 | **P0.** Confirm the Devpost form, team invitations, prize tracks, judge access, pitch rehearsal, video upload and submission screenshot. Keep `main` and checkpoint frozen. |
| Offline Phase 2 | Orchestrator; #199, #200–#203 | **P1.** Four worktrees and PRs based on the separate feature refs; checks, evidence and exact file ownership required. No PR to `main` pre-G6. |
| Historical issues | #87, #64, #123 | **Deferred, not forgotten.** #87 is the genuinely missing canonical frontend spec; #64 holds minor protected-contract wording; #123 is the genuine S5 collision cost. None is a reason to reopen Phase 1 implementation. |
| FE-E historical umbrella | #94 (closed) | UI timeline (#109), QA harness (#118), release images (#192), browser smoke (#134) delivered. Human GPU/fresh-clone/rehearsal checks transferred explicitly to #8; not claimed done. |

### First development sprint — four parallel contracts-free packages

1. **C1 correctness infrastructure:** #200 / P2-WP-01; invariant history checkers and replay harness. It creates the shared `runCustom` seam for later fuzzing, sweeps and bounds.
2. **C3 authoring safety:** #201 / P2-WP-04; formation linter L1–L5 and honest calibration report. Its UI consumer P2-WP-05 waits for this library.
3. **C2 visual explanation:** #202 / P2-WP-03; opt-in cascade layer from observed state. The production demo remains unchanged; P2-T06 and a real browser/performance/rehearsal pass gate any judged inclusion.
4. **Gemini offline foundation:** #203 / GF-WP-01; validated SceneSpec schemas and fixtures. This is **not** a Gemini API integration.

Each worker claims issue + branch + exact allowed-file set before editing. The reserved remote branches are `phase2/200-invariant-checker`, `phase2/201-score-linter`, `phase2/202-repair-cascade` and `phase2/203-gemini-scene-validation`. PR base is `phase2/development`; the lead orchestrator coordinates merges. Keep checks targeted during edits and run `bash scripts/check.sh` before review. Reject any unstated implementation change to protected contracts, `AGENTS.md`, root config, frozen evidence or the default demo. No synthetic acceptance claims.

### Sponsor integration development sequence (canonical specs, not implementation)

| Integration | Docs checked on `main` | Work packages / test plans | First authorised safe work | Dependency / explicit future decision |
|---|---|---|---|---|
| Gemini Flash-Lite formations | `docs/integrations/gemini-generated-formations.md` | **GF-WP-01…15**, `gemini-formation-evaluation.md` | GF-WP-01 #203: pure scene schemas and validation | GF-WP-02 canonical hash → geometry compiler 2D/3D → operator preview → generated recipe integration **only after D2/contract review** → optional model gateway **only after per-module D3** |
| MongoDB Atlas show library | `docs/integrations/mongodb-atlas-show-library.md` | **MDB-WP-01…09**, `mongodb-show-library-evaluation.md` | Audit and pure SavedShowComposition validator once the common canonical-JSON and offline X-IN dependencies are resolved | Shared gateway/connection, DB schema and endpoints **only after per-module D3**; composition paths must not drive the drone tick loop |
| Tiger Data experiment analytics | `docs/integrations/tiger-data-analytics.md` | **TIG-01…11**, `tiger-data-evaluation.md` | Repository audit, offline RunRecord validation / identity / pairing after canonical-JSON extraction | Database migrations, import, analytics API and dashboard **only after per-module D3**. Default demo and base evidence stay independent |

Provider-wide shared decisions and module boundary rules are in `docs/design/OPTIONAL_INTEGRATION_BOUNDARIES.md`. These three specifications contain **open questions and sign-offs**; documentation exists in depth, but not every architecture choice or sponsor eligibility condition is approved. No sponsor network calls, accounts, secret provisioning or APIs are part of this sprint's approval. The three integrations must not create separate competing gateways: `integrations/gateway/` is the one optional gateway proposal.

### Branch preservation / pruning audit (remote state at ~06:49 GMT)

- **Protected:** `main`, `checkpoint/phase1-complete-2026-11-15`, `evidence/freeze-0b2f8f3` (provenance), `phase2/development`, and all `phase2/20*-*` feature branches.
- **Fully absorbed or byte-identical candidates:** `fix/main-green-adoption-tests` (ancestor of main), `feat/23-observer-summary` (both changed files byte-identical on main), `test/g1beyond-comment-0b2f8f3` (changed file identical on main), `fix/revert-189` (both changed files identical on main). `fix/139-space-keyboard-focus` contains deliberately **reverted** keyboard behaviour; it is only a prune candidate after confirming no agent relies on it.
- **Preserve until individually triaged:** `docs/8-submission-package` (3 ahead of main), `docs/141-devpost-media` (1 ahead, old media), `fix/123-s5-adoption-pace` (3 ahead, abandoned experimental safety change), `spike/80-transition-collisions` (2 ahead), `test/94-harness-new-shell` (1 ahead). They have unique history. Do not delete merely because their PR is absent.
- **Deletion gate:** first `git worktree list --porcelain` and `git status` on each worktree; protect anyone's active or uncommitted work. Only then prune clearly absorbed or explicitly abandoned refs. Branch removal is not available through the connected GitHub actions used for this audit; this section is a candidate list, **not a deletion record**.

### Documentation status / known gaps

The Phase 2 architecture, roadmap, WPs, test matrix, candidate backlog and all three sponsors' canonical architecture/WP/evaluation sets exist on `main`. Their opening status banners date from initial proposal creation and do not reflect the newly authorised *offline* issue queue; **this execution document is the current implementation-status overlay**, not an implicit rewrite of those decisions. The GF-WP-01 kickoff approval is only offline scope.

`docs/design/frontend-ui.md`, `frontend-terminal.md` and `frontend-prototype-audit.md` from historical #87 **do not exist on main**. The accepted prototype handoff `research/ui-prototype/DESIGN.md` and the working UI do exist. #87 remains backlog to reconcile the final architecture and interaction/acceptance matrix after G6; do not assert the canonical document has been completed.

**Sprint completion definition:** all 4 child PRs verified and merged into `phase2/development` with tests and deterministic comparison recorded; baseline Phase 1 hash and showcase unaffected; new sponsor API usage **not claimed**; #8/G6 human actions independently confirmed. Only after those checks should the lead propose the next-wave issues and explicit D2/D3 approvals.
