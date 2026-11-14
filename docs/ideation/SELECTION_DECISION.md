# Selection decision

> **Status: SELECTED — C01 Encore.** Concept-specific implementation may start once the contracts PR is merged (see [`../planning/development-plan.md`](../planning/development-plan.md)).

- **Selected:** [C01 Encore](../../research/concepts/C01-encore.md), a 3D simulation of a decentralised, self-healing drone light show.
- **Date/time:** Sat 14 Nov 2026, ~18:05 GMT. Closed in issue #3.
- **Decided by:** Arnav, by explicit instruction to the orchestrator. The independent three-way scoring in the framework was **skipped**. Haris and Williams were asked on #3 to object immediately if they disagree; no sign-off is recorded.
- **Why:**
  - It maps directly onto the Neptune North challenge as the team reported it (decentralised coordination, independent decision-making, resilience to interrupted communication).
  - Composition is literal: the image is composed by independent drones, and the show is a composed score.
  - The MVP is pure software with no hardware or network dependency, and has a strong live demo (kill drones, watch the image repair itself).
- **Accepted risks:** the healing mechanism is unproven until gate G1; it can look like "just particles" unless decentralisation is made visible (X-ray view); the Neptune North brief is not verified online ([BRIEF P7](../competition/BRIEF.md#5-prize-tracks)).
- **Counterarguments considered:** the preliminary desk scores ranked C03 Patchwork and C06 Thirds slightly higher (within the stated tie margin), mainly on speed to a polished MVP. Encore was chosen for sponsor fit and technical depth.
- **Sponsor tracks:** Neptune North (primary). Others only if a verified brief fits.
- **MVP in one sentence:** 100+ simulated drones, each deciding locally, hold a formation, repair it after a judge kills drones, and spread a new composition by radio gossip, shown in 3D beside a static baseline.

## Alternatives archived

| ID | Reason not chosen | Could be revived if… |
|---|---|---|
| C02 Fugue | Weaker sponsor fit | — |
| C03 Patchwork | No fit to the Neptune North challenge | — |
| C04 Palette | Needs consumables; calibration risk | — |
| C05 Combinator | Least visual | A finance brief fits and Encore fails G1 early |
| C06 Thirds | Close to commodity auto-framing | — |
| C07 Chorus | Venue Wi-Fi risk | — (a physical add-on to Encore is ruled out: Encore is software-only) |
