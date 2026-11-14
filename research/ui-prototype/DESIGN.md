# Encore UI: design and implementation handoff

Status: **prototype for design approval.** Do not merge it into `src/app` until the design is approved. This document covers the design direction, the navigation and interaction map, the component inventory, the integration map against the contracts, the command language, the feature classification, the implementation guidance and a self-review.

Sources read: `README.md`, `docs/CURRENT_STATE.md` (Sat 20:15), `docs/design/experience-and-demo.md`, `docs/design/contracts-and-algorithms.md`, `docs/specification/requirements.md`, `docs/validation/evaluation-and-tests.md` (formulas), `src/contracts/*`, `src/score/*`, `src/sim/world.ts`, `src/agent/{staticBrain,steer}.ts`, `src/app/**`.

---

## 1. Design direction: an instrument, not a dashboard

**The swarm is the only saturated thing on screen.** All chrome is achromatic: near-black glass, hairline borders and an ice-white accent for focus and active states. Saturated colour is kept for meaning. The UI never uses the colours the experience doc reserves for diagnostics as decoration:

| Colour | Meaning (only) |
|---|---|
| Drone RGB | Exactly `DroneSnap.colour` (show) or the Okabe–Ito version palette (belief lens) |
| Cyan `#38e1f0` | Heartbeat carrying a claim |
| Magenta `#ff4fd8` | `SCORE` message; injected cue; contested slot |
| Vermilion `#ff5a1f` | Jam; vacant slot; "jammed" drop stub |
| Yellow `#f5d90a` | Partition; "partitioned" drop stub |
| Amber `#ffb547` | Slot in transit; tethers |
| White | Selection (four arcs) and deaf (full ring). Different shapes, so they never read alike |
| Amber outline tag | **proto**: runs only on the prototype engine |
| Dotted grey tag | **later**: designed, not built |
| Hatched grey | **observer**: ground truth the drone cannot see |

This continues the render slice already on `main`: background `#03080e`, the amber "FIXTURE" badge idea and Inter. Type is Inter Variable for the UI and JetBrains Mono Variable for every number, id, tick and command. Both are bundled with `@fontsource`, so the app needs no network. Numbers use tabular figures, so readouts do not jitter.

**There is no permanent dashboard.** The default screen is the 3D stage, a one-line readout (nPWC, alive, phase, fps) at the top right and a single dock at the bottom. Everything else opens from the dock, from a key, from the console or from the thing you clicked. `H` hides all controls for a clean performance.

## 2. Navigation architecture

### 2.1 Screen regions (they never move)

```
┌ brand · proto badge ───────────────────────────── readout: nPWC · alive · phase · fps ┐
│ [Composer panel]                                                 [Inspector panel] │
│  left, non-modal          3D STAGE (always visible)              right, non-modal   │
│                                                                                     │
│ legend (only while a lens needs one)          caption (demo only)                   │
│                  ┌ bottom trays: Console ▸ Show timeline (stack above the dock) ┐  │
│                  └ DOCK: ▶ clock speed reset | Compose Disrupt Lenses | Encore·Split·Static | Show Console | Help ┘
└─────────────────────────────────────────────────────────────────────────────────────┘
```

The three purposes in the brief map to these regions. **Performance** is the stage plus the transport. **Composition** is the Composer, the Show timeline and the Console. **Investigation** is Disrupt, Lenses, the Inspector, Compare and Metrics. They are not separate modes: a judge can kill a region while the composer is open and watch the result.

### 2.2 Surface types and rules

| Type | Surfaces | Behaviour |
|---|---|---|
| **Panel** (non-modal, persistent) | Composer (left), Inspector (right) | Stays open until closed. The viewport stays fully interactive |
| **Tray** (non-modal, docked) | Show timeline, Console | Stack above the dock. Both can be open together. Split view shrinks to fit above them |
| **Popover** (light-dismiss) | Disrupt, Lenses, Metrics, Help | At most one at a time. Closes on Esc, on an outside click or when it runs an action |
| **Transient** | Toasts, pick bar, preview bar, demo caption, hover label | Never take focus. Toasts are `aria-live` |
| **Modal** | none | No action needed one. Reset is the only destructive action. It rebuilds from the seed and is reproducible, so it does not ask for confirmation |

Shared rules, all implemented in `ui/surfaces.ts`:

- **Escape order:** cancel a pending pick → show the controls again → close the most recently opened surface → clear the preview → deselect.
- **Focus:** opening a surface moves focus into it when it has an input (composer text, console prompt). Closing it returns focus to whatever opened it.
- Dock buttons expose `aria-expanded`, and the open one is underlined.
- **Typing never triggers shortcuts.** Global keys ignore events from inputs, and the console stops propagation on every key.

### 2.3 Interaction map: every capability and how to reach it

| Capability | Dock / pointer | Key | Console | Contextual |
|---|---|---|---|---|
| Play / pause / step | ▶ | Space / `.` | `play` `pause` `step` | |
| Speed 0.25–4× | speed chip | `[` `]` | `speed 0.5` | |
| Reset from seed | Reset | R | `reset --seed 7` | `?seed=` URL |
| Camera orbit / pan / zoom | drag / right-drag / wheel | | | |
| Camera presets | Lenses › Camera | 1 2 3 | `camera top` | |
| Select and inspect a drone | click a drone | Esc deselects | `inspect 42 [--static]` | hover label shows id, slot, version |
| Compose a formation | Compose | F | `form text "WORD" --colors #A #B` · `form sphere` · `form helix` | |
| Preview (local only) | Composer › Preview in stage | Esc hides | `preview on/off` | preview bar |
| Inject into one drone | Composer › Pick in stage › Inject | I (current draft → selected drone) | `inject --drone 42` · `inject --pick` | Inspector › Inject here… |
| Kill selected / region / random | Disrupt | K (region pick) | `fault kill` · `fault kill-region --radius 8 [--at 42 / --pick]` · `fault kill-random --percent 10` | Inspector › Kill |
| Jam / lift jam | Disrupt | J (toggle) | `fault jam --radius 12 [--at 42 / --pick]` · `fault unjam` | Inspector › Jam around |
| Partition / reconnect | Disrupt | P | `fault partition on/off` | |
| Packet loss | Disrupt › slider › Apply | | `fault loss 20` | |
| X-ray, belief colours, ghosts, tethers, zones, neighbourhood | Lenses | X C G | `view xray on` … | legend appears while a lens is on |
| Compare | Encore · Split · Static | B cycles | `compare on/off/static` | |
| Metrics | readout (top right) | M | `metrics` | |
| Show timeline, scripted demo | Show | T, D | `timeline`, `demo run 90`, `demo stop` | |
| Performance mode | Lenses › Hide UI | H | | |
| Help, shortcuts, what is simulated, settings | Help, proto badge | ? | `help [cmd]` | |

## 3. The three required states

All three run in the same app, with the same dock and the same design system. The **Review** card at the top left (prototype-only) walks a reviewer through each one, and its **Show me** buttons drive the same actions as the controls. Screenshots are in `mockups/`.

**A. Main stage.** The swarm forms "ENCORE" from the launch grid. Drag, pan and zoom; presets glide (they jump under reduced motion). The dock has the transport. Lenses and Disrupt open as popovers and close with Esc or an outside click. `H` hides every control.
`mockups/A1-stage.png`, `A2-lenses.png`, `A3-performance-mode.png`

**B. Composition and console.** Compose (F) opens the left panel with drafts, name, a type card (Text / Sphere / Double helix, plus five **later** types), text with validation from the real font table, a two-endpoint gradient with curated swatches, a front-view thumbnail from `expandRecipe` and **Preview in stage**. The preview draws hollow rings over a dimmed swarm and sends nothing. **Transmit** is a separate step pinned to the bottom of the panel: pick one drone in the stage, see its status (alive, jammed, partition group, current version), then inject. Afterwards an adoption bar fills from observer `versions`. The same flow works in the console (`form text "DURHACK"`, `inject --pick`). The Show timeline places the injected cue in the plan lane and the adoption in the holds lane.
`B1-composer-validation.png`, `B2-composer-preview.png`, `B3-pick-drone.png`, `B4-injected-spread.png`, `B5-console.png`, `B6-timeline.png`

**C. Distributed-system analysis.** Click a drone: the Inspector separates **agent knowledge** (from `Belief` and `inspect()`) from a hatched **observer** box. X-ray draws real radio events: sampled heartbeats, cyan claims, magenta `SCORE`s and drop stubs, with the honest counter "radio drawn n / m". Destroy a region (K, a sphere follows the pointer and shows the live count) with ghost slots on. Jam the radio and white deaf rings appear. Inject outside the jam with belief colours on and the versions diverge. Split view stacks Encore above the static baseline with one camera, and the metrics popover compares both.
`C1-inspect-kill-ghosts.png`, `C2-jam-divergent-versions.png`, `C3-split-metrics.png`, `C4-disrupt.png`, `C5-partition.png`, `C6-demo-split.png`

## 4. Component inventory

| Component | File (prototype) | Responsibility | Reads | Emits |
|---|---|---|---|---|
| Session / action adapter | `engine/session.ts` | Owns both worlds and observers. Steps in lockstep (≤ 3×speed steps per frame). Resolves each Intent once into an `EnvEvent` at tick + 1 for both worlds. Keeps the event log | contracts, score, brains | `LogEntry` (accepted / applied / observed / error) |
| Stage | `render/Stage.ts` | One canvas, scissor split, shared camera, picking, region sphere, preview overlay | `ArmState.prev/curr`, `radioHistory`, `Observer.slotStatus`, `World.inspect` (selection only) | nothing |
| ArmView layers | `render/Stage.ts` | Drones and halos, deaf rings, death flash and ×, ghost rings (3 shapes), tethers, radio lines and stubs, jam spheres, partition plane and tint, selection (arcs, sensing sphere, radio ring, target cross, sensed lines) | as above | nothing |
| Store | `ui/store.ts` | Presentation state: lenses, view, selection, hover, pick request, preview, quality, reduced motion, hidden chrome. Version palette | | change events |
| Surfaces | `ui/surfaces.ts` | Panel and popover lifecycle, Esc stack, focus return, light dismiss, anchoring | | open/close |
| Actions | `ui/app.ts` | The one action API used by buttons, keys, console, demo and guide. Validates drafts against `FONT` and `expandRecipe` | session, store | Intents |
| Dock | `main.ts` | Transport, entry points, compare segmented control | session, store | actions |
| Readout | `main.ts` | nPWC (greyed in transition), alive, phase, fps; opens Metrics | `MetricsSample` | |
| Composer | `ui/Composer.ts` | Drafts, type, text, palette, thumbnail, preview, target pick, inject, adoption bar | drafts, score, snapshot (target status) | `inject` |
| Console | `ui/Console.ts` + `ui/commands.ts` | Prompt, history, completion, typed output, unified event stream | session log | commands → actions |
| Show timeline | `ui/Timeline.ts` | Plan lane (cues), events lane, holds lanes for both worlds, playhead, cue detail, demo control | `Session.cues()`, scheduled events, observer series | demo start/stop |
| Inspector | `ui/Inspector.ts` | Agent knowledge, generic JSON tree of private state, observer box, prev/next, actions | `World.inspect`, `Belief`; observer box: snapshot + `slotStatus` | kill / jam / inject |
| Lenses popover | `ui/popovers.ts` | Lens switches, camera presets, performance view, hide UI | store | lens changes |
| Disrupt popover | `ui/popovers.ts` | Kill region / selected / random, jam / unjam, partition, loss, each tagged main or proto | snapshot jams and partitions | Intents |
| Metrics popover | `ui/popovers.ts` | Encore vs static: nPWC + sparkline, alive, coverage, recovery, dupSlots, versions, radio/s, delivered, collisions, near misses, slot changes, tick, step ms, fps, quality, radio drawn n/m, seed | `MetricsSample`, `Observer.recovery` (mock of `tRec`) | |
| Help popover | `ui/popovers.ts` | Shortcuts, what is simulated (FR-37), label legend, reduced motion, quality | | settings |
| Legend | `main.ts` | Appears only for active lenses: radio key + honest counter, version counts, slot shapes, deaf count, partition groups | sample, stage counter | |
| Toasts, pick bar, preview bar, caption, hover label | `main.ts` | Transient feedback | | |
| Demo script | `ui/demo.ts` | The 90 s script, steps keyed to sim seconds, captions | | actions |
| Review guide | `ui/Guide.ts` | **Prototype only.** Do not port | | actions |

## 5. Technical integration map

### 5.1 UI action → contract

| UI action | Intent (adapter) | `EnvEvent` scheduled into **both** worlds | Main today |
|---|---|---|---|
| Kill selected | `kill{ids:[id]}` | `KILL{tick+1, ids}` | ✅ |
| Destroy region | `killRegion{centre, radius}` → `idsInSphere(Encore snapshot)` | `KILL{tick+1, ids}`: the same ids in both arms (FR-24) | ✅ (`idsInSphere` is declared in contracts §5 but not exported yet; the prototype has a local copy) |
| Kill 10 % | `killRandom{fraction}` → seeded pick | `KILL` | ✅ (should call `randomIds` once it is exported) |
| Jam / lift | `jamOn{centre, radius}` / `jamOff{id?}` | `JAM_ON{id, centre, radius}` / `JAM_OFF{id}` | ✅ |
| Partition / reconnect | `partitionOn{point, normal}` / `partitionOff` | `PARTITION_ON` / `PARTITION_OFF` | ❌ rejected by WP-2a |
| Packet loss | `setLoss{loss}` | `SET_LOSS` | ❌ |
| Inject | `inject{droneId, recipe, name}` → `composeNext(planScore, tick+1, recipe, droneId, n0, params)` + `observer.registerScore` | `INJECT_SCORE{droneId, score}` | ❌ |
| Play / pause / speed / step / reset | session only | none; reset rebuilds both worlds from the seed | ✅ |
| Lenses, camera, compare, selection | store only | none: **visual only** | ✅ |

### 5.2 Displayed data → source

| Display | Source |
|---|---|
| Drone position, colour, alive, death | `WorldSnapshot.drones[]`, interpolated by `alpha`; `alive` is not interpolated |
| Belief colours, deaf ring, hover version | `DroneSnap.belief.version`, `.deaf` |
| Radio lines, stubs, "drawn n / m" | `WorldSnapshot.radio[]` (`RadioEvent`), via `radioHistory` so no stepped tick is missed |
| Ghost rings, observer slot status | `Observer.slotStatus(snapshot)`, never recomputed by the app |
| Tethers | `belief.target` only |
| Jam spheres, partition plane and tint | `snapshot.jams`, `snapshot.partitions`, `DroneSnap.partitionSide` |
| Inspector, agent section | `World.inspect(id)` (`input`, `output`, `state` as a generic tree) and that drone's `Belief` |
| Inspector, observer box | snapshot (truth) and `Observer.slotStatus`, labelled |
| Readout, metrics, holds lanes, adoption bar | `MetricsSample` (`npwc`, `alive`, `coverage`, `dupSlots`, `versions`, `msgs`, `collisions`, `nearMisses`, `slotChanges`) |
| Recovery time | evaluation-doc `tRec` (the prototype computes it in the mock observer) |
| Plan lane | operator scores: the preloaded `Score.movements` plus each injected `composeNext` result. Superseded movements are dropped |
| Composer thumbnail and stage preview | `expandRecipe(recipe, n0, params)` |
| Text validation | `FONT` from `src/score/font.ts`, plus `expandRecipe` throwing |

### 5.3 Rules the prototype keeps (I6–I8, FR-03)

- The UI never mutates a world. The only writes are `World.schedule(EnvEvent)` in `Session.dispatch` and `World.step()` in the loop.
- The renderer draws lines only from `RadioEvent.delivered` and stubs only from the reason counts. It never invents a message.
- The static arm receives the same `INJECT_SCORE`. Its brain ignores it, and the UI says "capability difference" wherever the comparison is shown.
- Lenses are marked "visual only" where they are switched on.

## 6. Command language

### 6.1 Grammar

```ebnf
line      = command { arg } ;
command   = word [ word ] ;                 (* longest match against the table: "fault kill-region" *)
arg       = flag | value ;
flag      = "--" name { value } ;            (* fixed arity per flag: --colors takes 2 *)
value     = bare | '"' { any-but-quote } '"' ;
```

Tokenising respects quotes. The longest command path wins. Flags have a fixed arity, and values are typed (int, number, `#RRGGBB`, enum).

### 6.2 Commands

| Command | Status | Maps to |
|---|---|---|
| `help [cmd]` | ui | help text from the table itself |
| `form text "WORD" [--colors #A #B] [--name N]`, `form sphere`, `form helix` | main (score pkg) | new draft + validate + preview |
| `form svg FILE`, `form cloud FILE` | **later** | prints "planned, not built", changes nothing |
| `drafts`, `draft use ID`, `preview on/off` | ui | draft store |
| `inject [--drone N / --pick] [--draft ID]` | **proto** | `INJECT_SCORE` |
| `play`, `pause`, `step`, `reset [--seed N]`, `speed X` | main | session |
| `fault kill [--drone N]`, `fault kill-region [--radius R] [--at N / --pick]`, `fault kill-random [--percent P]` | main | `KILL` |
| `fault jam [--radius R] [--at N / --pick]`, `fault unjam [ID]` | main | `JAM_ON` / `JAM_OFF` |
| `fault partition on/off`, `fault loss P` | **proto** | `PARTITION_*`, `SET_LOSS` |
| `inspect N [--static]`, `inspect off`, `view LENS [on/off]`, `camera PRESET`, `compare on/off/static`, `metrics`, `timeline`, `clear`, `history` | ui | store / surfaces |
| `demo run 90`, `demo stop` | proto | demo script |
| `demo run 180`, `cue add`, `cue move`, `show save`, `show load`, `seek TIME` | **later** | prints "planned, not built" |

### 6.3 Pipeline

1. **Parse.** Tokenise, match the longest path, check flags and arity. On failure: an `error` line with the usage. Unknown commands get a Levenshtein "Did you mean …?".
2. **Validate.** Typed values and ranges (radius 0–40 m, loss 0–90 %, speed 0.25–4, a live drone id). Draft validation uses the score package itself.
3. **Dispatch.** Call the shared `Actions` with `quiet = true`, so feedback goes to the event log, not to toasts.
4. **Report.** `accepted`: the event was scheduled, with its tick. `applied`: the tick arrived. `observed`: a measured outcome, such as the adoption milestones 25/50/90/100 % from observer `versions`. These are different lines with different labels and colours, so "accepted" is never shown as "done".
5. **Completion.** Tab accepts the top suggestion. ↑↓ moves through suggestions when the list is open, otherwise through history. Inline ghost text shows the completion. Flags complete with hints, `--drone` suggests the selected drone and a few live ids, `--draft` lists drafts, `--colors` offers the curated swatches. Each suggestion carries its **proto** or **later** tag.
6. **Safety.** No `eval`, no shell, no dynamic import. Anything not in the table is an error.

## 7. Feature classification

| | Supported on `main` now | Runs on the prototype engine only (mocked) | Later (designed, not built) |
|---|---|---|---|
| Formations | text, sphere, helix via `expandRecipe`; gradient palettes; `makeScore`; `composeNext` | | point cloud, SVG, parametric, preset library, light patterns (each needs a new `Recipe` kind: `[contract]` PR) |
| Events | `KILL`, `JAM_ON`, `JAM_OFF` | `INJECT_SCORE`, `PARTITION_ON/OFF`, `SET_LOSS` | |
| Brains | static brain, `steer` | Encore brain (claims, healing, gossip) | |
| Observer | | `slotStatus`, `MetricsSample`, recovery | `sfMean`, `sfMax`, `RunRecord` export |
| Views | camera presets, orbit, Audience | X-ray, beliefs, ghosts, tethers, zones, inspector, split. They work on any engine that emits the contract snapshot, but their content is mocked until #16 and the observer land | follow camera, auto-orbit |
| Show | play, pause, speed, step, reset | 90 s demo | 3 min demo, cue add/remove/reorder/retime, save/load, import/export, seek (needs replay-to-tick) |

## 8. Implementation guidance (after approval)

### 8.1 File plan in `src/app` (keeps the experience doc §1 structure and the `import.meta.glob` loaders)

| Prototype | Production target |
|---|---|
| `engine/session.ts` (minus fixtures) | `src/app/worlds.ts` (both worlds + observers + loop) and `src/app/actions.ts` (Intent → EnvEvent) |
| `engine/fixture*.ts` | **Delete.** Use `createWorld` (#14), `encoreBrain` (#16), `createObserver` (WP-6) |
| `render/Stage.ts` ArmView | split into `render/layers/{Drone,Death,GhostSlot,Radio,Zone,Selection}Layer.ts` behind the existing `Layer` interface; scissor split goes in `WorldView`/`main.ts`; reuse `CameraRig` (same preset coordinates) |
| `ui/store.ts`, `ui/surfaces.ts`, `ui/dom.ts`, `ui/icons.ts`, `ui/styles.css` | `src/app/ui/` shared modules (no `createPanel` export, so the glob loader skips them) |
| `ui/{Composer,Console,Timeline,Inspector,popovers}.ts`, Dock/Readout/Legend from `main.ts` | one panel module each under `src/app/ui/`, each exporting `createPanel` |
| `ui/commands.ts` | `src/app/ui/commands.ts`, plus a vitest table test (parse, completion, error text) |
| `ui/demo.ts` | `src/app/ui/DemoScript.ts` |
| `ui/Guide.ts` | do not port |

### 8.2 Order, aligned with the gates

1. **G2 (render slice):** Stage, dock (transport + camera), readout, Help. Swap `fixtureWorld` for `createWorld` and `staticBrain`.
2. **G3 (radio):** X-ray layer + honest counter, zones, deaf rings, Disrupt (kill, jam), legend.
3. **G4 (dissemination):** Composer, Console, inject path, belief colours, adoption bar, Show timeline. Partition and loss go live once #14 accepts those events.
4. **G5:** Metrics from `createObserver` (with the HUD values checked against the CLI), Inspector, split, demo script.

### 8.3 Engineering notes

- **Inspector isolation (experience doc §6):** in production, give `Inspector.ts` and `SelectionLayer.ts` only `{ inspect: World.inspect(id), belief }` and a separate, pre-labelled `truth` object built by the adapter. The prototype reads the snapshot in one place for the observer box. That is acceptable for a mockup, but the import test will want it moved.
- **Performance:** both mock worlds take about 10 ms per tick headless (both arms, n0 = 200). The real brain may differ. If `stepMs` goes above about 4 ms on the demo laptop, move the worlds into a Web Worker and post snapshots. The UI only reads snapshots, so the move is mechanical. The quality ladder is implemented: `auto` drops halos and plain heartbeat lines below 30 fps, and `?q=low` forces it. Pixel ratio is capped at 1.5.
- **UI cadence:** the canvas renders every frame; chrome, legend, inspector, timeline and metrics refresh at 4 Hz. The inspector slows to 1 Hz while hovered, so text can be selected.
- **Error boundary:** a thrown error in the loop pauses the simulation and shows a toast with "press R to reset" instead of freezing.
- **Accessibility:** every control has an accessible name. Dock tooltips show the key. Popovers are `role=dialog`, the console is a `combobox` + `listbox` with `aria-activedescendant`, and output is a polite `log`. Focus rings use 2 px ice. No diagnostic depends on colour alone: rings differ in shape, deaf vs selected differ in shape, drop stubs differ in reason colour **and** are counted in the legend, and the partition plane is drawn. Reduced motion (OS setting or Help toggle) removes camera glides, pulses and flash fades. Captions are 20 px, numbers 12–17 px mono.
- **Offline:** fonts via `@fontsource`; no CDN; `dist-single/index.html` is fully self-contained.

### 8.4 Deviations from `experience-and-demo.md`, for the doc owner to accept or reject

| Doc says | Prototype does | Why |
|---|---|---|
| §7 Control panel with sections | Dock + Disrupt/Lenses popovers + Composer panel | Keeps the stage dominant; each section is still one click or one key |
| §7 HUD with every MUST metric on screen | Readout (nPWC both arms in split, alive, phase, fps) + Metrics popover (M, one click) | Keeps the stage clean. The honest counter also appears in the X-ray legend, next to the lines it qualifies. **Open question:** should the demo keep Metrics open throughout? The script opens it at 82 s |
| §2 Keys | All kept; added F, T, M, H, ?, `.`, `/`, Esc | No conflicts |
| §6 Truth column | Hatched "Observer" box under the agent section | The panel is narrow; stacking keeps both readable |

## 9. Quality review (designer + engineer)

| Question | Verdict | Evidence / what I changed |
|---|---|---|
| Is the swarm the dominant element? | **Yes** | Default screen: stage, readout, dock. The guide card is prototype-only. Fixed in review: halos were too faint, so dots are larger and glow more. Preview now dims the live swarm, so the hollow-ring target reads |
| Are popovers contextual rather than intrusive? | **Yes** | One popover at a time, anchored to its dock button, light-dismiss. Fixed: toasts covered the inspector, so they moved above the trays; split view was hidden under the trays, so it now shrinks to fit above them |
| Is navigation immediately understandable? | **Mostly** | One dock, labelled buttons with key tooltips, a consistent Esc order. Risk: "Show" for the timeline is short; user testing may prefer "Timeline" |
| Can users author and transmit a composition? | **Yes** | Composer has a three-step flow; validation comes from the real font table; transmit names exactly one drone and states the consequences |
| Is the terminal actually usable? | **Yes** | Grammar table, completion with ghost text, history, typed output, did-you-mean, later commands answered honestly |
| Are interactions grounded in the contracts? | **Yes** | Real `contracts`, `score` and static brain imported; every action goes through `schedule(EnvEvent)`; anything mocked is tagged **proto** |
| Does the UI scale to new features? | **Yes** | New formation kinds slot into the type grid (already listed as later); new events add one Disrupt row and one command row; new lenses add one switch and one layer |
| Are the three experiences consistent? | **Yes** | One dock, one surface manager, one token set, one action layer used by every input path |
| Can it ship without rewriting the simulation? | **Yes** | It needs only the contract API; the fixtures are drop-in stand-ins for #14, #16 and WP-6 |
| Deliberate product or generic AI dashboard? | **Deliberate** | No stat cards, no gradients in chrome, no permanent sidebars; colour carries meaning only |

**Known deficiencies, not fixed:**

1. The 3D preview overlaps the live formation when both are text at the same centre. A side-by-side "ghost stage" would be clearer; it is cut for scope.
2. The timeline lanes are rebuilt every 250 ms. Keyboard focus on a cue survives, but a production version should diff the DOM instead.
3. Swiftshader screenshots run at about 10 fps, so `auto` quality drops to low. Real frame rates need measuring on the demo laptop (NFR-01).
4. The mock brain is a simplification. Healing speed and churn in the prototype are **not evidence** for G1 and must not be quoted.

## 10. Technical changes needed to implement the design

1. **#14 world:** accept `INJECT_SCORE`, `PARTITION_ON/OFF` and `SET_LOSS`. Populate `partitions` and `partitionSide`. Export `idsInSphere` and `randomIds` as contracts §5 declares.
2. **#16 brain** and **WP-6 observer** (`createObserver`): the UI consumes them unchanged. Add `tRec` (recovery) to what the HUD can read, either through `summary()` or a small accessor.
3. **`src/app`:** add `worlds.ts`/`actions.ts` from `session.ts`; add the layers listed in §8.1; add the `ui/` modules; add `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` as dependencies (offline fonts). No change to `src/contracts` is required for the MVP.
4. **Tests:** a command-table test, an Intent → EnvEvent test (same object scheduled into both worlds), and an import test that `Inspector.ts`/`SelectionLayer.ts` do not receive `WorldSnapshot`.
5. **Docs:** update `experience-and-demo.md` §7 and §2 if the deviations in §8.4 are accepted.
