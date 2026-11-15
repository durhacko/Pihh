# Docs index

The map of the canonical documentation for **Encore**. One fact lives in one place; other docs link to it. New agent? Read [`../AGENTS.md`](../AGENTS.md), then [`CURRENT_STATE.md`](CURRENT_STATE.md), then the contracts doc, then your issue.

## Start here

| Doc | What |
|---|---|
| [CURRENT_STATE.md](CURRENT_STATE.md) | **Snapshot**: phase, gate times, what's open, blockers |
| [../AGENTS.md](../AGENTS.md) | Protocol for every AI agent: the three Encore rules, task states, claiming, handoff format |
| [development/WORKFLOW.md](development/WORKFLOW.md) | Cross-laptop coordination, merging, recovery, the agent bootstrap prompt |
| [planning/development-plan.md](planning/development-plan.md) | Gates, lanes, the work table (one row = one issue = one PR), dependencies, cut order |
| [project-manifest.yaml](project-manifest.yaml) | Machine-readable identity and source-of-truth pointers |

## Specification and design

| Doc | What | Status |
|---|---|---|
| [specification/requirements.md](specification/requirements.md) | Requirements FR/NFR with acceptance criteria; claims we must not make | Approved |
| [design/system-architecture.md](design/system-architecture.md) | Components, information rules I1–I8, the tick, two-world comparison | Approved |
| [design/contracts-and-algorithms.md](design/contracts-and-algorithms.md) | **CONTRACT.** Types, parameters, messages, composition format, healing algorithm, motion, baseline | Approved; change by `[contract]` PR only |
| [design/experience-and-demo.md](design/experience-and-demo.md) | 3D views, layers, controls, inspector, scripted demo, performance | Approved |
| [validation/evaluation-and-tests.md](validation/evaluation-and-tests.md) | Metrics, scenarios S0–S5, baseline fairness, test list, gate evidence | Approved; thresholds pre-registered |
| [planning/decisions-and-risks.md](planning/decisions-and-risks.md) | ADR-001…010, decision log, risks, fallback ladder, red-team answers | Living |

## Context

| Doc | What |
|---|---|
| [competition/BRIEF.md](competition/BRIEF.md) | Event facts with sources and verification status: deadline, rules, judging, prizes |
| [context/evidence-and-assumptions.md](context/evidence-and-assumptions.md) | Evidence register, prior art, simplifying assumptions, open questions |
| [context/research-handoff.md](context/research-handoff.md) | The original research packet. **Not received yet**: placeholder |
| [analysis/feasibility-and-scope.md](analysis/feasibility-and-scope.md) | Feasibility, MVP boundary (MUST / SHOULD / STRETCH), alternatives considered |
| [development/TEAM_ROLES.md](development/TEAM_ROLES.md) | People, GitHub handles, lanes |
| [development/readiness/sirahmo.md](development/readiness/sirahmo.md) | Haris's laptop and agent readiness evidence |

## Demo and submission

| Doc | What |
|---|---|
| [demo/DEMO_PLAN.md](demo/DEMO_PLAN.md) | Pitch, known-good demo path, fallbacks, judging traceability |
| [demo/SUBMISSION_CHECKLIST.md](demo/SUBMISSION_CHECKLIST.md) | Devpost and README requirements |
| [demo/DEVPOST.md](demo/DEVPOST.md) | Paste-ready Devpost text with marked placeholders for results |
| [demo/PITCH.md](demo/PITCH.md) | Timed spoken demo script and judge Q&A with linked evidence |
| [demo/QA.md](demo/QA.md) | Performance and screenshot harness: how to run it, what the numbers mean, targets, the demo-laptop record |

## History

| Location | What |
|---|---|
| [ideation/](ideation/SELECTION_DECISION.md) | How Encore was chosen; archived alternatives |
| [../research/concepts/](../research/concepts/) | Original candidate write-ups |
| [handoffs/INITIAL_SYNTHESIS.md](handoffs/INITIAL_SYNTHESIS.md) | Repo bootstrap handoff |

## How this maps to the architecture directive's layout

The directive proposed a `Documentation/` tree. The repo already had `docs/` with issues linking into it, so the same documents live here under these paths:

| Directive | Here |
|---|---|
| `00-index.md`, `project-manifest.yaml` | `docs/INDEX.md`, `docs/project-manifest.yaml` |
| `Context/*` | `docs/context/*` plus `docs/competition/BRIEF.md` |
| `Analysis/feasibility-and-scope.md` | `docs/analysis/feasibility-and-scope.md` |
| `Specification/requirements.md` | `docs/specification/requirements.md` |
| `Design/*` | `docs/design/*` |
| `Validation/evaluation-and-tests.md` | `docs/validation/evaluation-and-tests.md` |
| `Planning/development-plan.md`, `decisions-and-risks.md` | `docs/planning/*` |
| `Planning/agent-coordination.md` | `AGENTS.md` + `docs/development/WORKFLOW.md` (not duplicated) |
| `Operations/demo-and-submission.md` | `docs/demo/DEMO_PLAN.md` + `docs/demo/SUBMISSION_CHECKLIST.md` |
