# Encore UI prototype (reference only)

Approved design source for the production frontend. **This is not production code and is not built or tested by CI.**

- `DESIGN.md`: design direction, navigation map, component inventory, integration map, command grammar, implementation guidance.
- `src/`: the prototype's TypeScript. Port modules into `src/app/` through the normal issue and PR workflow, as the frontend issues describe.
- `src/engine/fixture*.ts` are **prototype-only stand-ins** for the world, brain and observer. They must never be imported by production code: production uses `createWorld`, `encoreBrain`/`staticBrain` and `createObserver`.
- `src/ui/Guide.ts` (review guide) is prototype-only and is not ported.
- `mockups/`: screenshots of the prototype running on its mock engine. They show the intended look, not measured behaviour; never quote numbers from them.

Not included here: the single-file minified build and the original zip (kept outside the repository).
