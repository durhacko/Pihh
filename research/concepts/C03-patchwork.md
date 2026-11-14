# C03: Patchwork, physical blocks that compose functions

> Status: candidate. Source: bootstrap research agent (2026-11-14). Confidence: low.

**One-liner:** Each physical block is a function (edge-detect, kaleidoscope, posterise, invert, blur). Line them up and the live camera feed passes through f∘g∘h. Reorder them and the output changes.

| Field | Content |
|---|---|
| Audience | Students learning programming or functional-programming ideas, creative coders |
| Why Composition | Function composition you can hold. Order matters (it doesn't commute), identity blocks, type errors. |
| Demo | A projector shows the judge's face. Swapping "edge then kaleido" gives a different output. An identity block changes nothing. A branch block blends two pipelines. A mistyped block (audio→image) glows red. |
| Mechanism | An overhead camera reads ArUco markers on the blocks (robust and cheap), or the blocks are chained electrically into a UNO Q. Composed WebGL/OpenCV stages are built at runtime. |
| Likely stack | Python + OpenCV, or a browser with WebGL shaders |
| Dependencies | Printed ArUco cards plus a laptop (zero risk). UNO Q optional (sponsor loan, **unverified**). |
| Prior art | Reactable (tangible synth), TuneTable (Georgia Tech, blocks as code). **We differ by** explicit typed function composition, including higher-order blocks, on a visual pipeline. |
| MVP | ArUco cards, 8 shader functions, blocks in sequence, projector |
| Stretch | Typed ports, "repeat ×n" and "map over tiles" blocks, electrical chain on the UNO Q, audio effects |
| Fallback | An on-screen drag-and-drop graph if marker detection fails |
| Effort | S–M |
| Risks | Reads as "Instagram filters" unless the pitch leads with the algebra |
| Sponsor fit | RS / Arduino UNO Q, hardware, design (**unverified**) |
