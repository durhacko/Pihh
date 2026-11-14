# Docs index

Start here. **Level A** docs are kept current. **B** docs are created when decisions are made. **C** docs are reference material.

## Start here
| Doc | Level | What |
|---|---|---|
| [CURRENT_STATE.md](CURRENT_STATE.md) | A | **Canonical snapshot**: phase, timeline, active issues, blockers |
| [../AGENTS.md](../AGENTS.md) | A | Protocol every AI agent follows (humans too) |
| [development/WORKFLOW.md](development/WORKFLOW.md) | A | Branching, PRs, reviews, conflicts, integration, launching an agent |
| [development/TEAM_ROLES.md](development/TEAM_ROLES.md) | A | Who owns what; GitHub handles |
| [DECISIONS.md](DECISIONS.md) | A | One-line decision log |

## Competition
| Doc | Level | What |
|---|---|---|
| [competition/BRIEF.md](competition/BRIEF.md) | A | **Single source of truth** for schedule, theme, judging, rules, prizes and sources, with verification status |

## Ideation (M0)
| Doc | Level | What |
|---|---|---|
| [ideation/IDEA_BACKLOG.md](ideation/IDEA_BACKLOG.md) | A | Candidate registry (one file per candidate in `research/concepts/`) |
| [ideation/EVALUATION_FRAMEWORK.md](ideation/EVALUATION_FRAMEWORK.md) | A | Gates, weights, decision meeting |
| [ideation/CANDIDATE_COMPARISON.md](ideation/CANDIDATE_COMPARISON.md) | A | Scores and shortlist |
| [ideation/SELECTION_DECISION.md](ideation/SELECTION_DECISION.md) | A | The decision record (**pending**) |

## Build (M1+; filled in after selection)
| Doc | Level | What |
|---|---|---|
| [product/MVP_SCOPE.md](product/MVP_SCOPE.md) | A | MVP, journey, must/should/cut |
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | A | Architecture checklist |
| `architecture/INTERFACES.md` (created at M1) | B | **Contracts** between components |
| [architecture/adr/](architecture/adr/) | B | Architecture decision records ([template](architecture/adr/0000-template.md)) |
| [quality/TEST_STRATEGY.md](quality/TEST_STRATEGY.md) | A | Lightweight test layers |
| [quality/RISK_REGISTER.md](quality/RISK_REGISTER.md) | A | Risks, owners, fallbacks |

## Demo and submission
| Doc | Level | What |
|---|---|---|
| [demo/DEMO_PLAN.md](demo/DEMO_PLAN.md) | A | Pitch, demo path, fallbacks, judging traceability, Q&A |
| [demo/SUBMISSION_CHECKLIST.md](demo/SUBMISSION_CHECKLIST.md) | A | Devpost and README requirements |

## Reference
| Location | Level | What |
|---|---|---|
| [../research/concepts/](../research/concepts/) | C | Candidate write-ups |
| [../research/experiments/](../research/experiments/) | B | Spikes (go/no-go) |
| [handoffs/INITIAL_SYNTHESIS.md](handoffs/INITIAL_SYNTHESIS.md) | C | Bootstrap handoff: what was set up and why |

**Deliberately not created** (to avoid empty docs): separate THEME/CHALLENGES/RULES/SOURCES files (merged into `BRIEF.md`), TASK_BOARD.md (GitHub Issues is the board), separate agent COORDINATION/TASK_PROTOCOL/HANDOFF files (all in `AGENTS.md`), REQUIREMENTS/USER_JOURNEYS/SUCCESS_CRITERIA (merged into `MVP_SCOPE.md`), ENVIRONMENT.md and INTERFACES.md (created at M1 when there's content).
