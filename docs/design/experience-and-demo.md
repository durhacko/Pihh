# Experience and demo

Purpose: what a judge sees and touches: render layers, visual encodings, controls, inspector, baseline comparison and the scripted demo. Status: **design, for acceptance at gate G0** (app-internal; must stay consistent with the contract). Owner role: Product / Research (experience and demo).

Types and parameter values are in [contracts](contracts-and-algorithms.md); rules I6–I8 in [system architecture](system-architecture.md); metric formulas in [evaluation and tests](../validation/evaluation-and-tests.md); requirement IDs in [requirements](../specification/requirements.md).

## 1. Rendering architecture

| File under `src/app/` | Responsibility (all MUST) |
|---|---|
| `main.ts`, `worlds.ts`, `actions.ts` | Loop; building both worlds and observers; turning actions into `EnvEvent`s. The only callers of `createWorld`, `step`, `schedule` |
| `render/{WorldView,SnapshotBuffer,CameraRig}.ts` | One view per world (canvas, scene, layers); previous and current snapshot with alpha; one camera shared by both views |
| `render/Layer.ts` | The interface below |
| `render/layers/{Env,Drone,Death,GhostSlot,Radio,Zone,Selection}Layer.ts` | One layer per file (§3). `render/layers/index.ts` loads them all with `import.meta.glob`, so adding a layer never edits a shared file |
| `render/colourModes/` | Colour modes (show, belief). Pure functions |
| `ui/{ControlPanel,Hud,Inspector,Captions,keys,DemoScript}.ts` | DOM only, no Three.js; `ui/index.ts` loads the panels the same way. Emit actions; never hold a world |

```ts
interface Layer {
  id: string;
  init(ctx: { scene: THREE.Scene; camera: THREE.Camera; params: Params }): void;
  update(f: { prev: WorldSnapshot; curr: WorldSnapshot; alpha: number; dtReal: number;
              slots?: { formation: Formation; inHold: boolean; status: SlotStatus[] } }): void;   // slots: from Observer.slotStatus
  setVisible(v: boolean): void;
  dispose(): void;
}
```

Two worlds, one script (MUST):

- An Encore world and a static world are created from the same seed, params, preloaded score and events. Only `brain` differs. They step in lockstep, so they always share a tick.
- Each action is resolved **once** into an explicit `EnvEvent` at `tick + 1`, and that object is scheduled into both worlds. A regional kill becomes `KILL{ids}` via `idsInSphere` on the Encore snapshot; an injection is built with `composeNext`.
- The static brain ignores `INJECT_SCORE`; the HUD labels this a capability difference.
- Loop: `acc += min(frameDt, 0.1) * speed`; step while `acc >= DT`, at most 5 steps per frame. Position and colour are interpolated; `alive` is not.
- Drones are one instanced unlit mesh; the drawn radius is not `dCollide`. Glow: bloom (SHOULD), halo sprites as fallback (MUST exist).

## 2. Camera and keys

- Presets (MUST), all looking at (0, 30, 0): `1` Audience from (0, 6, 95), FOV 50; `2` Three-quarter from (55, 45, 75); `3` Top from (0, 140, 0.1). `4` Follow selected is STRETCH.
- Mouse (MUST): drag orbit, right-drag pan, wheel zoom, click to select a drone. Auto-orbit ±15° (SHOULD).
- Keys (MUST): `Space` play/pause, `R` reset, `K` kill region, `J` jam, `P` partition, `I` inject, `X` X-ray, `C` belief colours, `G` ghost slots, `B` split, `D` demo, `[` `]` speed.

## 3. View layers

| Layer | Encoding | Tag |
|---|---|---|
| Audience | Near-black background, ground grid. Drone colour is exactly `DroneSnap.colour` (× 0.25 in X-ray so overlays read) | MUST |
| Death | On `alive` true→false: one 0.4 s flash, then hidden. In X-ray a dim `×` stays at the spot | MUST |
| Ghost slots | Ring per non-occupied slot, by status (§4); smaller for higher slot index | SHOULD |
| Tether | Line from a drone to its own `belief.target` while farther than `rOcc` from it. Never to a reference-formation slot | SHOULD |
| Radio X-ray | Lines from sender to `RadioEvent.delivered` receivers, 0.3 s fade. Plain `HB`: dim slate, sampled (every 4th broadcast, 3 receivers). `HB` with `claimSlot`: bright cyan. `SCORE`: bright magenta. Highlighted types drawn first, capped per broadcast | MUST |
| Dropped | Short stub at the sender per non-zero reason: `lost` grey, `jammed` vermilion, `partitioned` yellow. The log holds counts, not receiver ids, so a stub points at nobody | MUST |
| Honest counter | HUD "radio drawn n / m": links drawn over links logged in the last second. Never more lines than the log | MUST |
| Belief colours | One colour per score version (`issuedTick:origin`), in order of first appearance; legend with live counts | MUST |
| Deaf marker | White ring on any drone with `belief.deaf`, in every mode | MUST |
| Zones | Jam: translucent wire sphere. Partition: drones tinted by `partitionSide` (the plane only marks where the split was made; groups stay fixed wherever drones fly). Drawn from `snapshot.jams` and the snapshot's partition data, not UI state | MUST |

## 4. Requested versus occupied

Slot positions and status come from `Observer.slotStatus` ([contract §5](contracts-and-algorithms.md#5-world-events-snapshot-metrics)); the app never recomputes them. The legend says "observer view". Every live drone holds a slot; there is no unassigned state. Render the single status returned for each slot; the app does not choose between overlapping occupancy and holder-count predicates. The HUD still reports `dupSlots` independently, so its count need not equal the number of contested rings.

| Status | Rule | Drawn as |
|---|---|---|
| Occupied | A live drone within `rOcc` of the slot | Nothing |
| In transit | A live drone's `belief.slot`, none within `rOcc` | Thin amber ring, tether |
| Vacant | No live drone holds it | Thick vermilion ring |
| Contested | Two or more live drones hold it | Double magenta ring, slow pulse |

## 5. Baseline comparison

- **Stacked split (MUST):** Encore above, static below, on one `CameraRig`, so the divergence is simultaneous. The static radio layer stays empty: that brain sends nothing.
- **Fallback:** `B` toggles which world fills the view; both nPWC numbers stay in the HUD.
- **Regional kill only.** Priorities are interleaved in space, so a random kill thins both arms evenly and should look similar. A contiguous hole is where they are expected to differ.

## 6. Drone inspector

The inspector is SHOULD (WP-8c). If built, it is built ONLY from `World.inspect(id)` and that drone's `Belief`. `Inspector.ts` and `SelectionLayer.ts` never receive a `WorldSnapshot` and never import `src/agent`; an import test checks this.

| Source | Fields |
|---|---|
| `Belief` | `slot`, `heldSince`, `version`, `deaf`, `canHeal`, `claiming`, `peersKnown`, `log` |
| `state` | A generic collapsible JSON tree of `inspect().state`. No field names hard-coded, so a change to brain state cannot break the inspector |
| `input` | `tick`, `pos`, `vel`, inbox count by type, sensed count, nearest sensed distance |
| `output` | `accel`, `colour`, outbox count by type |

- In-world: `rSense` sphere, `rRadio` ring, a marker at `belief.target`.
- Truth column (SHOULD): separate, grey, headed "OBSERVER — not visible to this drone" (for example "peer 17: dead"). The only part fed from the snapshot.
- Dead drone: last inspect result, frozen, under a banner. Static drone: belief, input, output.

## 7. Control panel and HUD

| Section | Controls → event | Tag |
|---|---|---|
| Transport | Play/pause, reset (rebuilds both worlds from the seed), speed, seed | MUST |
| Disrupt | Kill region, kill selected → `KILL`; jam → `JAM_ON`/`JAM_OFF`; loss → `SET_LOSS` | MUST |
| Disrupt | Partition → `PARTITION_ON`/`PARTITION_OFF`; random 10% kill via `randomIds` | SHOULD |
| Compose | Recipe (text, sphere, helix), "Inject into selected drone" → `INJECT_SCORE` | MUST |
| View | X-ray, belief colours (MUST); ghost slots, split (SHOULD) | MUST |
| Demo | Run 90 s, run 3 min, stop | MUST |

HUD, 4 Hz, from each world's `MetricsSample`:

- **Headline: nPWC, Encore versus static** (MUST); greyed during transitions.
- MUST: alive / `n0`; drones per score version; messages per second and delivered share; `dupSlots`; collisions and near-misses labelled "measured"; tick, fps, quality level, "radio drawn n / m".
- SHOULD: recovery time, from the last kill until nPWC ≥ 0.95 held for 3 s, else "not recovered".

## 8. Formations and colour

- MUST: text in the 5×7 bitmap font (`ENCORE`), sphere, helix, all from `expandRecipe`.
- SHOULD: two saturated hues per palette. Avoid pure blue (dim), white (selection, deaf) and vermilion (vacancy).

## 9. Scripted demo

`DemoScript.ts` is a list of `{ tick, event?, view?, caption }` using the same dispatch as the buttons (MUST). Times are sim seconds at 1×, provisional until rehearsed at G2. Captions make no sponsor-fit claims: the theme wording and sponsor briefs are team-reported, not verified ([BRIEF](../competition/BRIEF.md) T1).

**90 seconds (MUST)**

| t (s) | Sim event | View | Judge sees |
|---|---|---|---|
| 0 | Reset; preloaded movement 0 (text) | Audience | Launch into `ENCORE` |
| 12 | — | X-ray | Dim, sampled real heartbeats |
| 16 | — | Split | Identical static arm below |
| 20 | `KILL{ids}`: `idsInSphere` over one letter, about 10% of `n0` | Ghosts | Same hole in both arms |
| 20–44 | None: drones act | — | Above: claim heartbeats, hole refilling from its rim, nPWC rising. Below: unchanged |
| 44 | Preloaded movement 1 (helix) | Split off | Survivors re-form with no messages |
| 54 | `JAM_ON`, upper third | Belief colours | Jam sphere, deaf rings; drones keep flying their score |
| 58 | `INJECT_SCORE` (sphere), one un-jammed drone | Speed 0.5× | New colour spreads along real `SCORE` lines; the jam blocks sends involving drones currently inside it |
| 58 + `scoreLead` | New movement starts | Speed 1× | Still-isolated drones keep the old score; drones that leave the geometric jam may receive and adopt the new score |
| 68 | `JAM_OFF` | — | Colour crosses; late adopters join by the clock |
| 82 | — | Audience | Sphere, final HUD |

**3 minutes (SHOULD)**

1. Launch into text; select a drone (inspector, sensing sphere).
2. Split; regional `KILL`; repair.
3. `KILL` a neighbour of the selected drone: its peer row stays, turns "suspected"; truth column says dead.
4. `JAM_ON` with no kills, then `JAM_OFF`: slot changes stay flat (silence is not death).
5. Preloaded sphere movement: slot persistence.
6. `PARTITION_ON`, then `INJECT_SCORE` into one group: the colour stops at the group boundary, and the two groups fly different formations.
7. `PARTITION_OFF`: reconnect, the newest version spreads, and claims made by the group left behind unwind.
8. `SET_LOSS` up, `INJECT_SCORE` (text): slower spread, finale, HUD totals.

## 10. Performance

- Target and floor: [system architecture](system-architecture.md) §6, measured at G2 with split and X-ray on.
- Frame budget (SHOULD): both worlds ≤ 3 ms, render ≤ 6 ms, glow ≤ 3 ms.
- Degrade order (MUST): plain heartbeat lines off → bloom off, halo sprites → pixel ratio 1 (start capped at 1.5) → static view at 30 Hz → lower drone-count preset.
- Quality fallback: `?q=low` forces the lowest level (MUST); automatic stepping is SHOULD.

## 11. Visual acceptance criteria

1. Someone not told the word reads it from an Audience screenshot.
2. Within 30 s of the regional kill, Encore's nPWC is above static's and the hole is visibly smaller above only.
3. Drawn links never exceed logged links; the static view draws none; pause freezes lines.
4. For a score injected outside the jam, drones continuously inside it from injection remain on the old version until radio becomes available. Check adoption against actual delivered messages: drones that leave the geometric jam may adopt before `JAM_OFF`, and messages eligible at send time may arrive after a drone enters the jam. A fixed partition, instead, isolates its groups wherever they fly. After radio reconnects, one colour remains (target 10 s, measured at G4).
5. If the inspector is built: it shows nothing that is not in that drone's `Belief` or `inspect` result.
6. A no-kill jam adds zero slot changes.
7. No ring for an `occupied` entry from `Observer.slotStatus`; the number of double magenta rings equals the number of `contested` entries in that same observer output. The HUD reports `dupSlots` separately, without requiring its count to equal the rendered contested-ring count.
8. Reset with the same seed gives identical HUD numbers at tick 600; the 90 s script runs unattended twice.

## 12. Cut order

Cut first, in order: follow camera, auto-orbit, truth column, 3-minute script, inspector depth, tethers, bloom (keep halo), stacked split (keep toggle), random kill button.

Never cut: radio lines from the real log with the n / m counter, nPWC for both arms, regional kill with visible repair, the measured collision count, reset.

Needed by gate: G2 §1, Audience, Death, reset, one camera preset · G3 Radio, Dropped, Zones, deaf marker · G4 belief colours, Compose · G5 HUD numbers equal the CLI's for the same seed · G6 the 90 s script.

## 13. Accessibility

- Belief palette is colour-blind-safe (Okabe–Ito: orange, bluish green, reddish purple, yellow).
- State is never colour alone: deaf is a ring, slot statuses differ in ring shape, dropped is a stub.
- Every demo action has a key (§2), shown on its button.
- Captions ≥ 20 px, HUD ≥ 16 px, high contrast. One death flash per drone; no strobing.

Pitch and fallbacks: [demo plan](../demo/DEMO_PLAN.md).
