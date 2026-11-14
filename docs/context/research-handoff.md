# Research handoff (original packet) and reconciliation

> **Status: the original packet is NOT in the repository.** `ENCORE_PROJECT_ARCHITECT_HANDOFF.md` (originally `Pasted text.txt`, about 831 lines, with the evidence register E001–E032) has been asked for three times and has never been attached. It is not on the orchestrator's machine either (searched 18:10 and 19:45 on 14 Nov). **Until it is pasted below, the reconciliation against it is not done**, and nothing in this repo may be described as checked against it.

Owner of this gap: Arnav. To close it: paste the full packet, unedited, under "Original packet" at the bottom of this file, in a PR. An agent then compares it line by line with [requirements](../specification/requirements.md) and [evidence and assumptions](evidence-and-assumptions.md), and files one issue per contradiction. Approved decisions are not reverted silently: each conflict is decided by the team under the [source precedence](../planning/decisions-and-risks.md#source-precedence).

## What the design was built from

The architecture directive of 14 Nov (which restates the packet's thesis, required decisions, scenarios, metrics and gates), plus the first candidate write-up in [`research/concepts/C01-encore.md`](../../research/concepts/C01-encore.md). The directive is the only statement of the original concept available, so the comparison below is against **the directive**, not the packet.

## Material changes from the original concept

Each row is something the approved design does differently from, or less than, what the directive described. They are recorded here so nobody assumes the original behaviour.

| # | Original concept (directive) | Approved design | Effect | Where decided |
|---|---|---|---|---|
| 1 | Drones broadcast vacancy observations, and help reorganise "where local knowledge permits" during communication interruptions | **A drone that hears no radio never claims a slot.** Vacancies are not broadcast; a drone claims only a hole it senses itself | **Healing is reduced under communication faults.** Inside a jam nothing is repaired until the jam lifts, even though jammed drones can see the hole. This is the largest change | [Contract §8.2, §8.5](../design/contracts-and-algorithms.md#8-healing-local-claims-adr-007), ADR-007 |
| 2 | Survivors redistribute to preserve the most important elements of the image | Repair is **local and greedy**: only drones within `rClaim` of a hole compete, and the loss is spread over the neighbourhood, not the whole formation. A wiped region with no survivor within sensing range is never detected | Less complete repair than a global reallocation; quantified by `npwc < 1` and the shape-fidelity metric | Contract §8.5 limits 1–2 |
| 3 | Gossip and membership: heartbeats, membership summaries, merged views | No gossiped membership. Each drone keeps a table of drones it hears directly | No drone has a swarm-wide view; nothing depends on one | ADR-005 |
| 4 | Partition: communication failure and physical failure are separate | Kept, with one exception that must be said out loud: a partition **during a formation change** looks like a mass failure to the group left behind, which then repairs its old formation; the claims unwind on reconnection | Extra churn, counted in slot changes and duplicate-slot seconds | Contract §8.5 limit 7 |
| 5 | Two claimants for one slot are resolved by tie-breaking | Kept, but two claimants that cannot hear each other can both commit. Resolved on radio contact (earlier holder keeps) or by one yielding when it sees the slot occupied | Temporary duplicates under partition or loss | Contract §8.5 limit 5 |
| 6 | Optional central ground-station baseline | Not built. Only the static pre-uploaded baseline | One comparison arm, not two | Contract §12 |
| 7 | At least 20 seeds per scenario, S0–S5 | Minimum evidence is 5 seeds on S0, S1, S2, S3, S5; 20 seeds and S4 are optional | Weaker statistics unless time allows the full matrix | [Evaluation §5](../validation/evaluation-and-tests.md#5-procedure) |
| 8 | Ghost view and inspector among the required views | Both optional (SHOULD); radio X-ray and belief colours stay required | Fewer explanatory layers in the MVP | [Development plan](../planning/development-plan.md#core-and-optional) |
| 9 | Score update gossip (unspecified detail) | Rebroadcast on adoption plus heartbeat anti-entropy, rate-limited, **never cancelled** | Slightly more `SCORE` traffic; no drone can be starved by a neighbour standing down | Contract §9; test T18 |
| 10 | Drone failures in general | Only "drone leaves the airspace" is modelled. A drone that fails dark but keeps hovering is never replaced | Narrower failure model | Contract §12 |

Unchanged and central: no drone reads global state; decisions originate in drones; radio silence alone is never treated as death; no convergence is promised across a lasting partition; collisions are measured, not ruled out; the project is software-only.

## Not yet possible

- Mapping the evidence items E001–E032 to [EV-01…](evidence-and-assumptions.md). None has been seen.
- Checking the packet's validation protocol, thresholds and prior-art claims against the evaluation doc.

---

## Original packet

*(not received; paste it here, unedited)*
