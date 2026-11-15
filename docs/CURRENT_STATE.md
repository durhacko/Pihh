# Current state

> **Canonical snapshot and the single operational record. Keep it short and edit in place; it is not a log.** Last updated: Sun 15 Nov 2026 ~06:35 GMT by Arnav's orchestrator. Live status: [issues](https://github.com/durhacko/Pihh/issues), [pull requests](https://github.com/durhacko/Pihh/pulls).

## Phase: **Engineering release frozen; human submission steps remain**

| Item | Value |
|---|---|
| **Release commit** | `458f1b17323b73f808a46ec397b125980cf6dfda` (main), CI green. Later commits are docs only. |
| **Evidence commit** | `0b2f8f3` ([#190](https://github.com/durhacko/Pihh/pull/190), notes fixed in #194, references in #197). The simulation code (`src/sim`, `agent`, `score`, `contracts`, `observer`, `cli`) is byte-identical between `0b2f8f3` and the release. The tables are identical to the first run at `571c8e4`, whose records are kept in `results/superseded-571c8e4/`. |
| **Backup video** | `demo-seed101-2026-11-15T06-21-25.mp4`: 97.25 s, 1920×1080, 60 fps, recorded on `458f1b1` with the hardware GPU, no demo problems, 180/180 alive at the end. sha256 `f829112860d38e75747a34e01653d4dac9ec6940ee614b8c723ad604fedc0c1f`. Copies in `~/encore-backup/` (WSL) and `C:\Users\arnav\Videos\encore-backup\`, all decoded with no errors. |
| **Release smoke** | All PASS on `458f1b1` ([#134 comment](https://github.com/durhacko/Pihh/issues/134#issuecomment-6890404655)): README launch, the scripted demo to its end with 0 toasts, reset, a hand-driven kill and local repair, score injection spreading (Encore only), the honest "not comparable" readout, and Space presenter controls. |
| **Outstanding engineering blockers** | None. |

Gates G0-G5 are met (see [evaluation doc §7](validation/evaluation-and-tests.md#7-gates)). Evidence and caveats are in [`results/RESULTS.md`](../results/RESULTS.md) and [`results/full/`](../results/full/): nPWC uses our own priority labels; coverage ties and is the only metric that cannot favour Encore; repair is local, never globally optimal; **S5 costs 103 collisions vs 14 (median of 5 seeds; 102, range 95-110, over 20 seeds), not like-for-like** ([#123](https://github.com/durhacko/Pihh/issues/123)).

## Known limitations (documented, not fixed)

- S5 collisions (above). An adoption-pacing fix was tried and not merged (#129: it caused false heals).
- Keyboard users activate dock buttons with Enter, not Space. Space is always play/pause, which keeps the presenter safe (#139; #189 and #191 were reverted in #196).
- Accessibility P1s are listed on [#139](https://github.com/durhacko/Pihh/issues/139); the red-team P2 residuals are on [#134](https://github.com/durhacko/Pihh/issues/134).
- Phase 2 / Gemini / MongoDB / Tiger Data documents are **proposed, not implemented**. No sponsor integration exists in the product.

## Human steps before 10:15 GMT (hard deadline 11:00)

1. Devpost: form, team invitations (Arnav Chitriv, William Pimentel, Haris Mohammed), challenge selection, and the sponsor brief and theme from the venue (#1). Paste [`demo/DEVPOST.md`](demo/DEVPOST.md).
2. Repository visibility or judges' access.
3. William and Haris confirm the AI-use credit in the README (checklist H13).
4. Rehearse with [`demo/PITCH.md`](demo/PITCH.md) on the presentation laptop's real screen and GPU.
5. Play the backup video once, then upload it.
6. Submit and confirm. Steps H1-H13 are in [`demo/SUBMISSION_CHECKLIST.md`](demo/SUBMISSION_CHECKLIST.md).

## Release rules until submission

Only the orchestrator merges. No code changes to `main` before submission. The commit history keeps its existing `Co-Authored-By` trailers until Arnav decides; new commits carry none.
