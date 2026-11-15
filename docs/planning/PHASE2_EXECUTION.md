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

| Work package | Issue | Files / owner boundary | Dependency | Status |
|---|---|---|---|---|
| P2-WP-01 / C1 | [#200](https://github.com/durhacko/Pihh/issues/200) | `src/observer/invariants.ts`, `src/cli/harness.ts`, new tests | Base only; no protected contracts | Ready to claim |
| P2-WP-04 / C3 | [#201](https://github.com/durhacko/Pihh/issues/201) | `src/cli/lint.ts`, `src/cli/lintReport.ts`, new tests | Base only; separate files from #200 | Ready to claim |
| P2-WP-03 / C2 | [#202](https://github.com/durhacko/Pihh/issues/202) | New cascade render layer, pure trail and new tests | Base; only an opt-in renderer | Ready to claim |
| GF-WP-01 | [#203](https://github.com/durhacko/Pihh/issues/203) | `src/score/generated/**`, new tests and schema fixtures | No SDK / gateway dependency | Ready to claim |

**No owners are assigned by this document.** The lead orchestrator must claim each issue and reserve the exact allowed-file set before an agent begins. Each agent works from an independent branch/worktree based on `phase2/development`, makes one small PR targeting that branch, and reports measured checks. Do not let agents merge their own PRs without coordinator review.

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
