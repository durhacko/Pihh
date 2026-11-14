# C01: Encore, a drone light show with no central controller

> Status: candidate. Source: prior team brainstorming, expanded by the bootstrap research agent (2026-11-14). Confidence: low (desk research only). No privileged ranking.

**One-liner:** A swarm of drones forms light-show shapes on its own. Each drone picks its place by agreeing with its neighbours, and the show repairs itself when drones fail or messages are lost.

| Field | Content |
|---|---|
| Problem / experience | Today's drone shows are scripted in advance from one central controller and are fragile when drones fail. Show a choreography the swarm assembles and repairs itself. |
| Audience | Show organisers and spectators. For judges, the hook is resilience. |
| Why Composition | Each image is made from many independent drones, and the show is a sequence of formation moves (morph, rotate, scatter). |
| Demo | A 3D browser sim of about 150 drones forms the DurHack logo, then the word "Composition". A judge clicks to kill 20% of the drones or cut comms between groups, and the swarm visibly redistributes. Message lines and a coverage % readout are shown. |
| Mechanism | Drones gossip with their neighbours and bid for target positions (an auction, or a simplified distributed CBBA). Collisions are avoided with ORCA or boids rules. Targets come from sampled SVG or text points. Message loss is injected deliberately. |
| Likely stack | Three.js plus a TypeScript or Python sim |
| Dependencies | None required. Optional: 8–16 LED nodes (ESP32 or UNO Q with WS2812 LEDs). Real drones are unrealistic (venue safety, access). |
| Prior art | Skybrush is open source but central, with trajectories computed in advance. SwarMer / Flying Light Specks (arXiv 2312.04571) is decentralised but only handles localisation. **We differ by** assigning positions live with no centre, self-healing, and an interactive failure demo. |
| MVP | The sim, 3 formations, failure injection, metrics overlay |
| Stretch | Music-reactive choreography, LED tabletop nodes, judges draw a shape on their phone, phones as physical nodes (see C07) |
| Fallback | If consensus oscillates, a toggle switches to central assignment, and the comparison becomes a feature |
| Effort | M |
| Risks | Looks like "just a particle sim" unless the lack of a centre is made visible |
| Sponsor fit | Hardware / RS / Arduino if LED nodes are added (**unverified**) |

## Hard gates
- [ ] Hardware confirmed (only needed for the stretch) · [x] Sim-only MVP has no external dependencies · [ ] Rules check
