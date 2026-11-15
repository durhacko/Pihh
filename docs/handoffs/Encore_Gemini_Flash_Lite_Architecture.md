> **Source handoff, preserved unmodified below this banner.** Author: William Pimentel (`wpimento`). Received Sat 14 Nov 2026 23:32 GMT as `Encore_Gemini_Flash_Lite_Architecture.md`; added to the repo by Arnav's orchestrator under issue #117. This is William's **source architecture proposal**, not a record of implemented features and not an approved design. Facts in it about providers, prices and the codebase reflect the time it was written and may have changed. The canonical, reviewed specification is [`../integrations/gemini-generated-formations.md`](../integrations/gemini-generated-formations.md); where the two differ, its conflict records explain why. Nothing below this line has been edited.

---

# Encore × Gemini 3.1 Flash-Lite: Complete Technical Architecture

> **Detailed design for AI-generated 2D silhouettes and coloured 3D drone formations**, based on the uploaded Encore repository and Google's Gemini API documentation. This document consolidates the preceding explanation in Markdown, including the architecture, model choice, data formats, algorithms, timing, limitations, MongoDB/TigerData integration, and acceptance criteria.

---

## 1. What we are trying to achieve

The goal is to let someone describe almost any recognizable object in natural language and have Encore's simulated drone swarm reproduce it as a formation of coloured lights.

We want **two modes**:

### Mode A — 2D Silhouette

The user types **“Generate a silhouette of an elephant.”**

Gemini describes the elephant's two-dimensional outline using mathematical curves and shapes. Encore reconstructs that outline, selects **200 suitable target points**, and positions the drones on a flat vertical plane.

**Target:** A clear, recognizable, largely monochrome shape when viewed from the audience camera.

*Visual reference:* A black side-profile elephant silhouette becomes a recognizable elephant-shaped arrangement of individual drone lights.

### Mode B — 3D Coloured Formation

The user types **“Generate a 3D elephant with grey skin, large ears and white tusks.”**

Gemini describes the elephant as interconnected three-dimensional mathematical shapes, including individual colours, dimensions, orientations, and important features.

Encore samples points across those shapes, assigns a position and RGB colour to every drone, and creates a formation with actual depth that can be viewed from multiple angles.

**Target:** A recognizable, stylized, coloured 3D object made from drone lights.

*Visual reference:* A stylized grey 3D elephant sculpture becomes a sparse but genuinely three-dimensional point cloud with grey body lights, contrasting ears/eyes, and ivory tusks.

**Neither mode uses an AI image generator.** The object is constructed procedurally from Gemini's structured text output.

We are **not** asking Gemini to fly the drones, coordinate the swarm, calculate collision avoidance, or choose individual drone movements. Those remain responsibilities of Encore's existing simulation.

### What makes this different from ordinary AI-generated artwork?

The intended technical contribution is:

**Natural-language description → compact mathematical scene representation → physically constrained drone formation → decentralized execution.**

The scene must eventually obey real simulation requirements: fixed drone count, minimum spacing, speed and acceleration limits, score propagation, and recovery from failures. A visually plausible description alone is insufficient.

---

## 2. The exact Gemini model we are using

**Model:** Gemini 3.1 Flash-Lite  
**Gemini API model ID:** `gemini-3.1-flash-lite`  
**Free API tier:** Available, subject to project quota and rate limits.

The earlier explanation identified these capabilities and published specifications:

| Property | Specification |
|---|---|
| Exact model ID | `gemini-3.1-flash-lite` |
| Input | Text, images, audio, video, PDFs |
| Output | Text only |
| Native image generation | **No** |
| Native 3D mesh generation | **No dedicated mesh output** |
| Structured JSON output | Yes |
| Maximum input context | 1,048,576 tokens |
| Maximum output | 65,536 tokens |
| Thinking levels | Minimal, low, medium, high |
| SDK | `@google/genai` |
| Free-tier token pricing | Free within available quota |
| Paid standard text input | $0.25 per million tokens |
| Paid standard output | $1.50 per million tokens, including thinking |

> **Verification note:** Model availability, quotas, and prices can change. The figures above reproduce the preceding design discussion; check current Google Gemini model and pricing documentation before relying on them for budgeting. Use the intended model identifier, rather than the older `gemini-3.1-flash-lite-preview` designation mentioned as discontinued in the earlier review.

The large context limit is not especially useful to Encore. We should aim for small, tightly structured responses, not thousands of lines of geometry.

### Why this model is suitable

Flash-Lite is designed for fast, inexpensive structured text generation. That matches the task: **describe a subject as mathematical components**.

For instance, Gemini need not output an elephant illustration. It needs to determine that an elephant has a large body, head, four legs, ears, a curved trunk, tusks and a tail—and place these consistently in 2D or 3D coordinates.

**Primary weakness:** Flash-Lite is not a reliable CAD modeller or precision geometry engine. It can generate semantically convincing JSON that produces visually incorrect geometry. The architecture therefore needs deterministic validation and human-visible previews.

### Recommended model configuration

| Parameter | 2D silhouette | 3D coloured |
|---|---|---|
| Model | `gemini-3.1-flash-lite` | Same |
| Response format | JSON Schema | JSON Schema |
| Thinking level | `minimal` initially | `low` initially |
| Temperature | Experiment around 0.2–0.5 | Experiment around 0.2–0.5 |
| Target output | ~500–1,200 tokens | ~1,000–2,500 tokens |
| Scene complexity | ~6–20 parts | ~12–30 parts |
| Target drone count | 200 | 200 |
| Maximum regeneration | One optional retry | One optional retry |

These are proposed settings to benchmark, not guaranteed optimal settings. Lower temperature may help consistency but does not guarantee geometric correctness. If minimal thinking produces poor results, compare low and medium thinking against quality and latency.

Google's free-tier limits depend on the project and applicable request/token quotas. Check actual account limits in Google AI Studio.

---

## 3. Complete high-level architecture

Use **one AI service, two scene-description schemas, and one shared formation compiler**.

```text
Encore Frontend (Vite + TypeScript + Three.js)
  Prompt · 2D/3D selector · Generate · Preview · Fly · Save
                        |
                        v
Node.js API Server
  Protect API key · Build mode-specific prompt · Validate input
                        |
                        v
Gemini 3.1 Flash-Lite
  Structured scene JSON only — no image generation
                        |
           +------------+------------+
           |                         |
           v                         v
     SceneSpec2D                SceneSpec3D
  Contours, Béziers,         Solids, tubes, colours,
  filled regions, cutouts    transforms, importance
           |                         |
           +------------+------------+
                        |
                        v
Deterministic Formation Compiler
  Reconstruct geometry · Sample candidates · Allocate features
  Enforce 1.5 m spacing · Fit bounds · Build 200 target slots
                        |
                        v
Formation Preview
  Inspect positions, colours, dimensions, transition estimate
                        |
                        v
Encore Simulation
  Score injection · Radio dissemination · Local flight control
                        |
            +-----------+-----------+
            |                       |
            v                       v
     MongoDB Atlas               TigerData
  Save scenes and runs       Analyse telemetry
```

### Strict separation of responsibilities

| Component | Responsible for | Must not do |
|---|---|---|
| Gemini | Understand prompt, describe geometry and appearance | Output final flight commands |
| Node backend | API access, schemas, validation, caching coordination | Run individual drone brains |
| Geometry compiler | Deterministically construct and sample shapes | Call Gemini during simulation ticks |
| Score system | Define formations, slot priority and movement timing | Secretly assign actual drones using global runtime state |
| Encore brains | Local coordination, score propagation, steering | Call MongoDB or Gemini |
| Renderer | Show simulated formations and previews | Alter actual simulation outcomes |
| MongoDB | Persist prompts, scenes and replay metadata | Determine live drone positions |
| TigerData | Store and analyse simulation measurements | Influence simulation decisions |

**Offline principle:** After a scene has been generated and accepted, the score must contain enough information to reconstruct it without Gemini, MongoDB, or any external service. This preserves Encore's decentralized design.

---

# Part I — 2D Silhouette Generation

## 4. How the 2D mode works, step by step

The central idea is to treat Gemini as a **vector-graphics scene designer**, not a raster-image generator.

A 2D silhouette is a collection of filled regions and boundaries. Those can be described mathematically without generating a PNG or JPEG.

### 4.1 User input and interpretation

Example request:

> Generate a side-view silhouette of an elephant, facing right, with a raised trunk and visible tusks.

The backend enriches the request with the engineering requirements of the simulator: recognizable from the positive-Z audience direction, normalized coordinates, limited number of drone lights, and bold contours rather than tiny details.

| Elephant feature | Suitable geometry | Importance |
|---|---|---|
| Large torso | Ellipse or rounded closed Bézier path | High |
| Head | Ellipse or custom closed path | High |
| Trunk | Thick cubic Bézier curve | Very high |
| Four legs | Rounded polygons or capsules | High |
| Ear | Closed curved contour | High |
| Tusks | Thin curved strokes | Very high |
| Tail | Narrow Bézier curve | Medium |
| Eye | Small contrasting region | Optional for pure silhouette |

The model needs expressive geometry but should **not** generate every final drone point.

### 4.2 The 2D output format

Use a dedicated `SceneSpec2D` schema:

```typescript
type SceneSpec2D = {
  version: 1;
  mode: "silhouette2d";
  title: string;
  view: "front" | "side" | "three-quarter";
  foreground: string;
  parts: Shape2D[];
};

type Shape2D = {
  id: string;
  operation: "union" | "subtract";
  geometry: Geometry2D;
  priority: number;
};
```

`Geometry2D` should be a validated union of ellipses, polygons, closed Bézier paths, and thick curved strokes.

The most useful primitive for organic silhouettes is **cubic Bézier geometry**. Ellipses and capsules are useful shortcuts but are insufficient on their own for arbitrary animal silhouettes.

A cubic Bézier segment with four control points is:

\[
B(t)=(1-t)^3P_0+3(1-t)^2tP_1+3(1-t)t^2P_2+t^3P_3,
\qquad 0\le t\le 1.
\]

It can describe trunks, tails, curved backs, manes, and other contours compactly.

#### Example partial SceneSpec2D

```json
{
  "version": 1,
  "mode": "silhouette2d",
  "title": "Raised Trunk Elephant",
  "view": "side",
  "foreground": "#FFFFFF",
  "parts": [
    {
      "id": "body",
      "operation": "union",
      "geometry": {
        "type": "ellipse",
        "center": [-0.15, 0],
        "radii": [0.65, 0.42]
      },
      "priority": 4
    },
    {
      "id": "trunk",
      "operation": "union",
      "geometry": {
        "type": "stroke",
        "points": [
          [0.55, 0.2],
          [0.85, 0.1],
          [0.93, -0.35],
          [0.78, -0.65]
        ],
        "width": 0.14
      },
      "priority": 5
    }
  ]
}
```

This is an **incomplete illustrative excerpt**, not a complete elephant. A real scene also needs the head, ears, legs, tusks, tail, and correctly joined contours.

Use a fixed local coordinate convention (for example, X and Y approximately in `[-1, 1]`, with Y pointing up) and enforce its permitted range.

`operation` allows geometric unions and subtractions. Cutouts can preserve negative space between legs or other defining gaps, but excessive subtraction can disconnect the silhouette.

### 4.3 Convert geometry into a silhouette mask

The local compiler reconstructs the shapes and can rasterize them into an internal **512×512 binary mask** for geometric processing.

This is **not** an AI-generated image or a user-facing image file.

The mask helps with:

- Combining shape unions and cutouts.
- Detecting connected and disconnected regions.
- Identifying the filled interior.
- Extracting outer boundaries.
- Supporting boundary and interior candidate sampling.

The mask need not be the final precision limit. Original vector geometry can still be used to sample smooth boundaries.

### 4.4 Generate candidate drone positions

For 200 drones, generate roughly **800–2,000 candidate points**, then select a physically valid subset.

| Candidate source | Purpose |
|---|---|
| Outer boundary | Preserve recognizable outline |
| Filled interior | Provide density without requiring a huge perimeter |
| Protected feature geometry | Keep trunk, tusks, legs, and other important details visible |

An initial experiment might allocate around 30–40% of the final points to boundary and feature curves, with the remainder filling major regions. This is a heuristic, not a general optimum.

Every candidate should carry metadata:

```typescript
type FormationCandidate = {
  pos: [number, number, number];
  colour: [number, number, number];
  featureId: string;
  importance: number;
};
```

For a white 2D silhouette:

```typescript
const pos: [number, number, number] = [x, y, 0];
const colour: [number, number, number] = [1, 1, 1];
```

The constant Z makes the formation flat. X and Y define what the audience sees.

### 4.5 Select the final 200 points

The existing `src/score/fps.ts` provides `farthestPointOrder()`, an efficient way to spread selected points through a candidate set. But uniform farthest-point sampling alone can erase critical details.

A large body could receive most of the points while a narrow trunk receives almost none. Without the trunk, the elephant becomes unrecognizable.

Use **feature-aware, spacing-constrained selection**:

```text
1. Scale the silhouette to a permitted flight area.
2. Generate boundary, interior, and feature candidates.
3. Reserve feasible positions for critical features.
4. Select separated points along the main contour.
5. Fill the remaining budget using constrained FPS.
6. Verify all pairwise distances >= 1.5 metres.
7. Confirm exactly 200 unique positions.
8. Assign stable priorities and slot indices.
9. Reject or simplify if the constraints cannot be met.
```

The same minimum-spacing rule must apply across *all* protected and unprotected candidates.

#### Priority order matters

Encore treats lower slot indices as higher priority. Therefore, high-priority points should preserve recognition **across the whole shape**, not cluster around one feature.

It would be a mistake to put the first 40 slots exclusively along the trunk. If 40 drones survive, they should still suggest an elephant, not merely a trunk.

A useful target is **recognizability at every prefix** of the priority-ordered slot list: coarse global shape first, then progressively finer details as more drones remain available.

### 4.6 Place the silhouette in Encore's world

The existing audience camera is toward positive Z and views a target near `(0, 30, 0)`.

For 2D:

- Put the silhouette in the **XY plane**.
- Keep **Z fixed**.
- Preserve aspect ratio while scaling.
- Centre the silhouette at a safe altitude.
- Enforce minimum spacing and bounded dimensions.

Illustrative *proposed* limits:

| Constraint | Proposed starting point |
|---|---|
| Maximum silhouette width | 40 m |
| Maximum silhouette height | 25 m |
| Minimum altitude | 5 m |
| Minimum pair spacing | 1.5 m |
| Number of target slots | 200 |
| Audience viewpoint | Positive Z |

These dimension/altitude caps are **proposed new safeguards**, not settings already present in the uploaded code.

Exactly 200 positions may not fit in the prescribed area for every narrow or intricate shape. The compiler must then simplify, expand within permitted bounds, or reject the scene. It must not duplicate slots or violate spacing just to hit 200.

### 4.7 Specific 2D flaws and limitations

| Flaw | Why it happens | Recommended mitigation |
|---|---|---|
| Silhouette looks like disconnected blobs | Simple primitives poorly approximate organic outlines | Continuous Bézier contours and connected-region checks |
| Incorrect anatomy | Flash-Lite isn't a vector artist | Few-shot examples, landmark constraints, preview, optional regeneration |
| Trunk or tail disappears | Narrow features receive too few points | Feature-specific point reservations |
| Huge formation | Scaling to nearest-pair spacing expands everything | Fixed bounds first, then constrained sampling |
| Outline-only geometry is too sparse | 200 boundary points imply a large perimeter | Combine boundary and interior filling |
| Holes disappear | Masks or sparse samples lose thin cutouts | Validate cutout sizes; preserve important negative spaces |
| Different camera views look wrong | The object is physically flat | Label it as audience-facing 2D artwork |
| 200 points aren't enough | Complex detail exceeds the resolution budget | Simplify or reject unsupported detail |
| Arbitrary text shapes fail | Model may generate poor letter contours | Use Encore's existing deterministic text recipe |
| Camera rotation breaks recognition | Flat lights overlap differently when viewed obliquely | Keep a designated audience view and accurate mode labeling |

#### The outline-spacing limitation

If all 200 drones were placed around a single continuous outline with at least 1.5 m between consecutive points, the perimeter would generally need to be at least:

\[
200\times1.5=300\text{ metres}.
\]

This is why a **filled silhouette with selected boundary points** is more practical than an outline-only placement.

**2D verdict:** This is the simpler and more reliable Gemini integration. Its main difficulty is keeping the subject recognizable with a fixed number of physically separated lights, not computing the geometry.

---

# Part II — Coloured 3D Formation Generation

## 5. How the 3D mode works

The 3D mode constructs a genuine volumetric object using mathematical primitives. It does **not** reconstruct an image, nor does it create a photorealistic mesh.

### Example elephant decomposition

| Component | Geometry | Colour |
|---|---|---|
| Torso | Large ellipsoid | Medium grey |
| Head | Smaller ellipsoid | Light grey |
| Ears | Flattened rotated ellipsoids or custom surfaces | Grey/pink |
| Legs | Tapered capsules | Medium grey |
| Feet | Short rounded cylinders | Dark grey |
| Trunk | Curved tapered tube | Grey |
| Tusks | Curved tapered tubes | Ivory |
| Eyes | Small spheres | Dark charcoal |
| Tail | Thin curved tube | Grey |

The result is a stylized object with real XYZ coordinates and real depth.

### 5.1 The 3D SceneSpec

Use a separate 3D schema with explicit materials and geometry:

```typescript
type SceneSpec3D = {
  version: 1;
  mode: "scene3d";
  title: string;
  referenceView: "front" | "side" | "three-quarter";
  materials: Material3D[];
  parts: Part3D[];
};

type Material3D = {
  id: string;
  rgb: [number, number, number];
};

type Part3D = {
  id: string;
  shape: Geometry3D;
  materialId: string;
  importance: number;
  symmetry?: "none" | "mirror-x";
};
```

`Geometry3D` should be a tightly validated union: ellipsoid, capsule, cone, cylinder, and tapered tube (at minimum).

Each shape needs an explicit transform: centre, dimensions, orientation. Define coordinate conventions and rotation units/order consistently, then convert to quaternions internally as needed.

#### Example partial 3D elephant SceneSpec

```json
{
  "version": 1,
  "mode": "scene3d",
  "title": "Grey Elephant",
  "referenceView": "three-quarter",
  "materials": [
    {"id": "skin", "rgb": [0.50, 0.53, 0.57]},
    {"id": "ears", "rgb": [0.65, 0.58, 0.61]},
    {"id": "ivory", "rgb": [0.96, 0.91, 0.77]},
    {"id": "eyes", "rgb": [0.06, 0.06, 0.07]}
  ],
  "parts": [
    {
      "id": "body",
      "shape": {
        "type": "ellipsoid",
        "center": [0, 0, 0],
        "radii": [0.85, 0.60, 0.50]
      },
      "materialId": "skin",
      "importance": 4
    },
    {
      "id": "head",
      "shape": {
        "type": "ellipsoid",
        "center": [0.72, 0.32, 0],
        "radii": [0.45, 0.48, 0.42]
      },
      "materialId": "skin",
      "importance": 5
    },
    {
      "id": "trunk",
      "shape": {
        "type": "taperedTube",
        "points": [
          [1.02, 0.12, 0.08],
          [1.18, -0.15, 0.08],
          [1.24, -0.55, 0.12],
          [1.10, -0.73, 0.15]
        ],
        "startRadius": 0.14,
        "endRadius": 0.07
      },
      "materialId": "skin",
      "importance": 5
    }
  ]
}
```

This example is **partial**, showing body, head, and trunk. A full elephant must include appropriately placed ears, tusks, legs, eyes, and tail.

Reject undeclared material IDs, invalid radii, unsupported symmetry, malformed tubes, inconsistent transforms, and out-of-range coordinates.

### 5.2 Construct the surfaces

The compiler converts parametric primitives into sampled surfaces.

For an ellipsoid centred at `(cx, cy, cz)` with radii `(a, b, c)`:

\[
\begin{aligned}
x &= c_x+a\sin\theta\cos\phi\\
y &= c_y+b\cos\theta\\
z &= c_z+c\sin\theta\sin\phi.
\end{aligned}
\]

A curved tube needs a centreline and a local frame along that curve; its radius can taper, as required for a trunk or tusk.

#### 3D surface sampling is not automatically uniform

Uniform sampling in polar angles does **not** generally distribute points uniformly over a surface; it may cluster them near poles.

Use approximately surface-area-weighted sampling. A triangle-mesh intermediate representation can simplify surface-area sampling and visibility/intersection tests for more complex primitives.

### 5.3 Remove hidden and intersecting geometry

An elephant's head overlaps the torso. If both whole surfaces are sampled, some candidate positions will lie inside the combined object and waste drones.

The initial compiler can reject a candidate if it lies strictly inside another opaque primitive, where robust inside-tests are available.

The reverse problem also matters: an important feature such as a tusk may be positioned too deeply inside the head and get filtered away.

Protect important visible features, but do not preserve obviously nonsensical points inside solid objects. A full constructive-solid-geometry engine is a much larger project; start with simple union-aware filtering.

### 5.4 Generate coloured 3D candidates

For 200 drones, initially create around **2,000–5,000 candidate positions** on exposed surfaces.

Each candidate should retain geometry and visual metadata:

```typescript
type Candidate3D = {
  position: [number, number, number];
  normal: [number, number, number];
  colour: [number, number, number];
  featureId: string;
  importance: number;
};
```

The surface normal helps estimate which candidates are visible from a given audience direction.

Without visibility-aware sampling, uniform 3D distributions may put too many drones on the back side, making the elephant look sparse or unrecognizable from the chosen camera.

### 5.5 Allocate drones intelligently

The selection algorithm should balance:

1. **Recognizability** from the main view.
2. **Genuine 3D depth** for camera rotation.
3. **Physical feasibility**, especially minimum spacing.

An illustrative 200-drone allocation might be:

| Feature group | Example drones |
|---|---:|
| Body and main silhouette | 65 |
| Head and ears | 55 |
| Trunk and tusks | 45 |
| Legs, tail, details | 35 |
| **Total** | **200** |

These numbers are illustrative, not automatically optimal; the compiler should adapt allocations to feasibility and feature significance.

A possible candidate ranking objective is:

\[
Q(p)=\alpha I(p)+\beta V(p)+\gamma D(p),
\]

where:

- `I(p)` measures feature importance.
- `V(p)` measures visibility from the reference view.
- `D(p)` measures distance from already selected points.

Apply the score while strictly enforcing minimum 3D separation.

#### Visibility versus true 3D

Prioritizing the front too heavily makes the front view look good but leaves the back sparse. Uniformly distributing points over every surface may make all views sparse.

Use a designated reference camera (for example, a three-quarter audience view) and favour it **without entirely sacrificing rear-side geometry**. The objective is recognizable, stylized 3D—not photographic fidelity from every viewpoint.

### 5.6 Per-drone RGB colours

Encore already uses a `Slot` containing a position and colour. The flow is:

```text
Gemini material palette
    ↓
Per-primitive material IDs
    ↓
Coloured candidate points
    ↓
Feature-aware selection
    ↓
Encore Slot.colour = [R, G, B] (normalized 0–1)
```

The existing `src/score/expand.ts` uses a left-to-right two-colour gradient. Generated 3D scenes need a new branch that **preserves the sampled colour** from each candidate's material or surface.

Rendering limitations:

- Drone lights are isolated luminous points, **not textured polygons**.
- Dark colours may be difficult to see against the night sky.
- Three.js colour-space conversion can alter the appearance of naive sRGB-to-linear assignments.
- Belief-colour and X-ray diagnostic modes can override artistic colours.
- Realistic gradients, textures, shadows, and detailed skin patterns require additional procedural colouring and cannot be assumed.

For an elephant, contrasting grey body/ears, ivory tusks, and visible eye details are more useful than many barely distinguishable grey tones.

### 5.7 Specific 3D flaws and limitations

| Flaw | Consequence | Mitigation |
|---|---|---|
| Gemini generates incorrect anatomy | Malformed object | Strong examples, restricted primitives, human preview |
| Primitive parts intersect badly | Overlapping blobs | Union-aware surface filtering |
| Thin details get no drones | Missing tusks, tail, eyes | Protect important feature allocations |
| Wrong viewpoint or orientation | Key features hidden | Explicit coordinate and camera conventions |
| Too few visible points | Sparse object | Visibility-aware sampling |
| Excessive point density | Violates 1.5 m separation | Spacing-constrained selection |
| Unbounded scale | Impractically large formation | Maximum world-space bounding box |
| Colours look wrong | Poor recognition | Correct RGB conversion and contrast checks |
| Valid JSON but poor object | Geometry compiles yet is unrecognizable | Numerical validation plus visual preview |
| Missing back-side detail | Camera rotation reveals gaps | Multi-view inspection and minimum depth coverage |
| Nondeterministic geometry | Replay/slot mismatch | Fixed seed, stable ordering, versioned compiler |
| Flight paths cross | Long transitions and collision risk | Stable correspondence and trajectory tests |
| Poor priority weights | Too many lights spent on one feature | Feature quotas and global-shape balance |

**3D verdict:** Feasible as *AI-assisted procedural 3D sculpture using drone lights*, not as photorealistic text-to-3D. Main limitations are Flash-Lite's geometric accuracy and how recognizable the shape remains with just 200 points.

---

# Part III — Integrating Both Modes Into Encore

## 6. The shared formation compiler

Both modes must produce Encore's existing essential `Formation` structure:

```typescript
interface Formation {
  slots: Slot[];
  dense: Vec3[];
  bounds: {
    min: Vec3;
    max: Vec3;
  };
}

interface Slot {
  index: number;
  pos: Vec3;
  colour: RGB;
}
```

There is no need for a second simulation engine or AI-controlled drone class.

### Proposed compiler interface

```typescript
type CompileResult = {
  formation: Formation;
  warnings: string[];
  sceneHash: string;
  compilerVersion: string;
};

function compileGeneratedScene(
  scene: SceneSpec,
  params: Params
): CompileResult;
```

The compiler dispatches to the appropriate geometry implementation and produces the same final formation contract.

| Stage | 2D silhouette | 3D coloured |
|---|---|---|
| Input | Vector contours and regions | Parametric solids and tubes |
| Intermediate geometry | Binary mask and vector boundaries | Coloured surface candidates |
| Candidate count | ~800–2,000 | ~2,000–5,000 |
| Selection | Feature-aware spacing | Feature- and visibility-aware spacing |
| Local Z | Fixed at 0 | Variable |
| Colour | Usually one foreground colour | Per-material RGB |
| Final output | 200 target slots | 200 target slots |
| Dense reference | Sampled silhouette | Sampled 3D surface |

The `dense` reference matters: Encore's observer uses it to evaluate geometric fidelity. Do not replace the dense reference with only the chosen 200 slots and then claim that fidelity measures accuracy against the originally intended shape.

**Determinism:** Given the same validated SceneSpec, compiler version, parameters, and sampling seed, the compiler should return the same ordered slots.

### 6.1 Connect SceneSpec to `Recipe`

Add a generated recipe variant:

```typescript
type GeneratedRecipe = {
  kind: "generated";
  compilerVersion: 1;
  sceneHash: string;
  scene: SceneSpec;
};

type Recipe =
  | TextRecipe
  | SphereRecipe
  | HelixRecipe
  | GeneratedRecipe;
```

The existing text, sphere, and helix variants remain supported. The new scene compiler becomes another recipe-expansion path.

### 6.2 What should travel over the simulated radio?

Two options:

| Option | Mechanism | Tradeoff |
|---|---|---|
| **A: Send SceneSpec** | Drones receive a compact mathematical description and reconstruct slots deterministically | Compatible with current recipe system; receiver needs the same compiler |
| **B: Send compiled slots** | Drones receive the final ordered XYZ+RGB positions | Exact positions and little reconstruction; somewhat larger payload and different recipe structure |

For the current Encore codebase, start with **Option A: self-contained SceneSpec inside the score**.

`expandRecipe()` memoizes formations, which helps the single-process simulator reuse expensive computations.

Do not rely on unseeded randomness, browser-only objects, mutable shared state, or live database lookups during execution.

For future multi-device deployment, compiled-slot transmission may be safer. As a rough size estimate, 200 positions stored as three 16-bit coordinates plus three 8-bit colours require:

\[
200\times(6+3)=1{,}800\text{ bytes}
\]

before metadata, packet framing, retransmission, or error correction. Even that exceeds many realistic tiny radio payloads, so it would need consideration of fragmentation in real hardware.

### 6.3 Existing recipe-cache performance issue

The current expansion cache uses a key based on serialization:

```typescript
const key =
  `${JSON.stringify(recipe)}|${n0}|${params.slotSpacingMin}`;
```

That is cheap for `sphere` but potentially wasteful for a nested scene with 25–30 primitives, particularly when brain logic asks for expansion repeatedly.

Instead:

- Validate the complete SceneSpec.
- Derive a canonical, content-addressed `sceneHash`.
- Verify the hash rather than trusting one supplied by Gemini.
- Cache on the hash, compiler version, drone count, spacing, and placement parameters.
- Preserve the complete scene in the score for offline replay.

Also update `copyRecipe()` in `src/score/compose.ts`: its current palette-copy behaviour must become safe for nested generated scenes. Prefer immutable/frozen scene records or a deliberate deep-copy strategy.

---

# Part IV — Timing and Performance

## 7. How long 2D and 3D generation will take

There are **two separate clocks**:

- **Wall-clock time:** Gemini request, validation, geometry compilation, preview.
- **Simulation time:** Score dissemination, transition, settling.

The user should see the preview **before** the drones finish forming the object.

### 7.1 Estimated generation latency

These are **planning estimates**, not live benchmarks of the proposed integration.

| Stage | 2D elephant | 3D elephant |
|---|---:|---:|
| Network and model response | 3–12 s | 6–25 s |
| JSON validation | Usually under 0.1 s | Usually under 0.1 s |
| Geometry reconstruction | ~0.05–0.5 s | ~0.1–2 s |
| Candidate selection and checks | ~0.01–0.2 s | ~0.02–0.5 s |
| Preview update | ~0.05–0.3 s | ~0.05–0.5 s |
| **Preview planning range** | **~4–15 s** | **~7–30 s** |

These assume one successful request, efficient implementation, and no retry. Real latency can be longer due to server load, rate limits, output complexity, failed validation, or slow local hardware.

Generating 200 3D points is not particularly expensive; **Gemini's ability to construct correct scene geometry is the larger uncertainty**.

### 7.2 Why Flash-Lite latency varies

Latency depends on output tokens, input complexity, reasoning settings, network conditions, and service load.

A 2D heart might need only a handful of components. A full elephant needs more anatomy, orientation, dimensions, colours, and curves.

If model output passes JSON validation but fails geometry feasibility, regeneration can add another model request.

**Optimize first-attempt success rate, not just tokens-per-second.** Use one Gemini call for the scene, not separate calls for every anatomical part.

### 7.3 Score dissemination timing

The uploaded configuration includes:

```typescript
DT = 0.05;
scoreLead = 60;
scoreResendMin = 40;
scoreJitter = 10;
```

Thus the existing lead is:

\[
60\times0.05=3\text{ simulated seconds}.
\]

The simulated radio also has a default 15-metre range, 1–2 ticks of latency, and approximately 5% per-receiver message loss in the prior code review.

A new score initially enters **one drone**, then must propagate over the decentralized radio graph.

Three simulated seconds are **not a guaranteed whole-swarm adoption interval**. Loss, topology, retransmissions, or a partition can delay score adoption beyond the scheduled movement start.

**Gemini generation time does not overlap with radio propagation** unless a separate preparation protocol has been designed: the score cannot disseminate until it is injected.

Recommended MVP approach:

1. Generate and compile while the existing show continues.
2. Preview the new target formation.
3. Inject the score into one drone.
4. Use a tested dissemination lead (for example, experiment with 8–15 simulated seconds).
5. Measure adoption at the movement start tick.
6. Report late adoption rather than silently assuming success.

Longer leads improve chances in connected networks but cannot guarantee delivery across partitions.

### 7.4 Formation transition timing

The existing `src/score/timing.ts` schedules:

\[
T_{\text{transition}}
=\frac{d_{\max}}{0.5v_{\max}}+3.
\]

With `vMax = 8 m/s`:

\[
T_{\text{transition}}=\frac{d_{\max}}{4}+3.
\]

The result is rounded to simulation ticks of 0.05 seconds.

| Max corresponding-slot displacement | Scheduled transition |
|---:|---:|
| 10 m | 5.5 s |
| 20 m | 8 s |
| 30 m | 10.5 s |
| 40 m | 13 s |
| 60 m | 18 s |

These are **scheduled** durations, not guarantees that every drone has arrived and settled.

#### Same-index correspondence is a significant flaw

The current timing logic compares `from[i]` with `to[i]`, but generated slot ordering may bear little relationship to old slot ordering.

This can require unnecessary crossing movements and increase travel distance, avoidance activity, and collision risk.

Start with stable priority-aware ordering; consider deterministic correspondence optimization later. Reordering must preserve Encore's meaning of high-priority slots and be reproducible on every drone.

### 7.5 Example end-to-end timeline

A hypothetical successful 3D elephant generation:

| Stage | Elapsed |
|---|---:|
| Gemini 3.1 Flash-Lite | 15.0 s |
| Validate, compile, preview | 0.7 s |
| Proposed dissemination lead | 10.0 s |
| Transition with 40 m max displacement | 13.0 s |
| **Preview available** | **15.7 s after prompt** |
| **Scheduled hold begins** | **38.7 s after prompt** |

This assumes 1× simulation speed, immediate user acceptance, no regeneration, and adequate dissemination. The drones may not all have arrived or settled by the hold tick.

**Make preview and flight separate experiences.** The user should get immediate feedback after compilation without waiting for every drone to complete the transition.

### 7.6 Runtime bottlenecks

The current simulator runs two worlds in lockstep and samples observer metrics every five ticks.

If a dense reference contains ~2,000 points and the scene has 200 drones, one straightforward geometric comparison costs roughly:

\[
2{,}000\times200=400{,}000
\]

distance comparisons per sample per world, before other work.

This is manageable in principle but argues strongly against putting geometry reconstruction, JSON serialization, network uploads, or large mutable data operations inside the simulation loop.

The browser's animation loop can cap steps per rendered frame. Under load, requested playback speed can differ from achieved wall-clock speed. Measure both simulated ticks and actual elapsed time.

---

# Part V — Backend and Frontend Implementation

## 8. Exact Gemini integration

The uploaded Vite/TypeScript project needs a small **Node.js API service** so the Gemini key remains server-side.

### Proposed endpoint

`POST /api/generate-formation`

Request:

```json
{
  "prompt": "A 3D grey elephant with curved trunk and white tusks",
  "mode": "scene3d"
}
```

Response after validation, in an illustrative envelope:

```json
{
  "success": true,
  "model": "gemini-3.1-flash-lite",
  "mode": "scene3d",
  "scene": {
    "version": 1,
    "mode": "scene3d",
    "title": "Grey Elephant",
    "materials": [],
    "parts": []
  },
  "sceneHash": "example-hash",
  "modelLatencyMs": 0
}
```

The empty arrays and zero latency are placeholders showing the response envelope, **not valid production geometry or measured performance**.

### Suggested Gemini SDK call

```typescript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

async function generateScene(
  prompt: string,
  mode: "silhouette2d" | "scene3d"
) {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: prompt,
    config: {
      systemInstruction:
        mode === "silhouette2d"
          ? PROMPT_2D
          : PROMPT_3D,
      responseMimeType: "application/json",
      responseJsonSchema:
        mode === "silhouette2d"
          ? scene2dJsonSchema
          : scene3dJsonSchema,
      thinkingConfig: {
        thinkingLevel:
          mode === "silhouette2d"
            ? "minimal"
            : "low"
      },
      temperature: 0.3
    }
  });

  if (!response.text) {
    throw new Error("Gemini returned no scene");
  }

  return validateScene(
    JSON.parse(response.text),
    mode
  );
}
```

`PROMPT_2D`, `PROMPT_3D`, `scene2dJsonSchema`, `scene3dJsonSchema`, and `validateScene` are **not existing implementations**. They must be defined and tested.

Use separate manageable schemas for 2D and 3D instead of one excessively complex union. Google's structured output can constrain syntax, but application-level semantic validation is still required.

### Validation layers

| Layer | Failure example | Behaviour |
|---|---|---|
| Request validation | Empty/oversized prompt | Input error |
| JSON parsing | Incomplete response | Reject; optionally retry |
| Schema validation | Missing radius, invalid material | Reject |
| Geometry validation | Non-finite coordinate, disconnected curve | Reject |
| Complexity validation | Hundreds of components | Reject |
| Feasibility validation | Cannot place 200 separated drones | Simplify or reject |
| Preview validation | Object looks like the wrong animal | Human review, regeneration, or editing |

The preview layer is inherently hard to automate without an additional visual-evaluation model. Because the intended integration uses Flash-Lite text output, start with deterministic checks plus human visual confirmation.

### Why a backend is necessary

Do **not** put the Gemini API key into browser code or a `VITE_` environment variable. That would expose it in the client bundle.

The backend should manage input lengths, access controls/rate limiting as appropriate, timeouts, 429 handling, response-size limits, and validated outputs.

---

## 9. Proposed source-code structure

```text
src/
  contracts/
    generatedScene.ts       NEW: SceneSpec2D and SceneSpec3D
    score.ts                EXTEND: generated Recipe variant

  score/
    generated/
      compile.ts            NEW: common compiler
      shapes2d.ts           NEW: 2D vector geometry
      shapes3d.ts           NEW: 3D parametric geometry
      sample2d.ts           NEW: boundary/interior sampling
      sample3d.ts           NEW: surface sampling
      placement.ts          NEW: world placement and bounds
      selection.ts          NEW: constrained candidate selection
      validation.ts         NEW: geometric validation
      hashing.ts            NEW: stable canonical scene hashes

    expand.ts               EXTEND
    compose.ts              EXTEND
    timing.ts               TEST/OPTIMIZE

  app/
    ui/
      AIFormationPanel.ts   NEW
      FormationPreview.ts  NEW
    workers/
      formation.worker.ts  NEW

  observer/
    ...                     EXISTING
  sim/
    ...                     EXISTING

server/
  index.ts                  NEW
  routes/
    generate.ts             NEW
    formations.ts           NEW
  services/
    gemini.ts               NEW
    mongo.ts                NEW
    tiger.ts                NEW
  schemas/
    scene2d.ts              NEW
    scene3d.ts              NEW
```

### Why a browser Web Worker?

Scene compilation should not freeze the UI or interrupt Three.js frame rendering.

The worker should run the pure TypeScript geometry compiler and return a frozen `Formation` plus warnings. Keep the compiler independent of DOM APIs and renderer state so it is also usable in Node-based tests.

The main app previews the exact positions and injects the generated recipe only after validation and operator acceptance.

---

# Part VI — Important Architectural Risks

## 10. Flaws that could invalidate the approach

### Critical: The model does not understand geometric feasibility reliably

Flash-Lite may produce a semantically convincing scene with misplaced, intersecting, disconnected, or incorrectly oriented primitives.

**Mitigation:** The compiler is authoritative; geometry validation and a human-visible preview are mandatory.

### Critical: 200 drones impose a severe resolution limit

Highly detailed 3D objects cannot be faithfully represented by 200 isolated lights.

**Mitigation:** Stylized geometry, strong silhouettes, critical-feature protection, bounded detail budgets, and explicit rejection or simplification.

### Critical: Minimum spacing can conflict with world bounds

It may be impossible to place 200 appropriately separated points inside a particular narrow shape and bounding volume.

**Mitigation:** Scale to permitted world bounds *before* sampling and selecting; never rescale without a maximum limit to force spacing.

### High: Score propagation may miss the scheduled start

The present three-second lead does not guarantee adoption across a lossy multi-hop network.

**Mitigation:** Measure dissemination, adjust tested lead time, report late adoption and partitions honestly.

### High: Slot correspondence may produce inefficient transitions

Same-index matching can create unnecessarily long or crossing paths.

**Mitigation:** Stable priority-aware ordering and later deterministic correspondence optimization if necessary.

### High: Scene complexity increases message size

The radio simulation treats `SCORE` as a complete message and does not currently model airtime proportional to payload size.

**Mitigation:** Compact scenes, payload-size reporting, and an explicit disclosure that realistic packet fragmentation is not modelled.

### High: Free-tier availability is not guaranteed

Quota exhaustion, 429 responses, latency spikes, and retries can disrupt a live demonstration.

**Mitigation:** MongoDB caching, known-good saved scenes, and a working offline fallback.

### Further limitations

| Area | Specific issue | Treatment |
|---|---|---|
| Determinism | Floating-point/transcendental differences across engines | Quantize, seed, test replay; use canonical transmitted slots if necessary |
| Versioning | A new compiler may change old scenes | Save schema/compile versions |
| Colour consistency | Linear vs sRGB, glow and blending | Explicit colour handling and visual tests |
| Geometry quality | Valid parts can be badly assembled | Connectivity, landmark, preview checks |
| Scene safety | Oversized or low-altitude object | Flight-volume constraints |
| Collision avoidance | Spaced targets don't guarantee safe paths | Transition tests and collision reporting |
| Radio realism | Large message has no realistic bit-rate cost | Disclose abstraction; add packetization later |
| Evaluation | Fidelity metric may disagree with slot coverage | Interpret against `dense` reference and compare fair conditions |
| User prompts | Ambiguous views or impossible detail | Constrain and clarify supported complexity |
| Security | Untrusted prompts and generated data | Validate; never run AI-generated code or raw SVG markup |
| Free-tier data handling | Provider data-use terms may apply | Avoid sensitive/private prompts and secrets |
| Browser speed | Large geometry/observer work can drop frames | Worker, cache, profile, bound candidates |
| Recovery | Generated scores may only partially propagate | Track score versions and occupancy separately |
| Concurrent requests | Late response can overwrite newer prompt | Request IDs and stale-result rejection |

The earlier uploaded snapshot had a temporary `staticBrain` fixture in place of the actual Encore brain. Under the stated assumption that the simulation is ready for sidetrack integration, the design assumes the correct brain is now connected. Verify that on the actual demo branch.

---

# Part VII — MongoDB Atlas and TigerData

## 11. What the other two sidetracks contribute

Neither database should be required for drones to operate.

### MongoDB Atlas — Generated formation library

Save the **actual validated SceneSpec**, not just the prompt, so replay doesn't depend on Gemini returning the same content again.

| Field | Purpose |
|---|---|
| `formationId` | Unique identifier |
| `prompt` | Original user request |
| `mode` | 2D or 3D |
| `modelId` | `gemini-3.1-flash-lite` |
| `sceneSpec` | Validated geometry JSON |
| `sceneHash` | Content-derived identifier |
| `compilerVersion` | Deterministic interpretation |
| `droneCount` | Normally 200 |
| `placementParams` | Bounds, spacing, orientation |
| `createdAt` | Timestamp |
| `generationMs` | Gemini request latency |
| `compileMs` | Geometry compilation latency |

This enables a show library, caching, and offline-friendly replay. Saving canonical compiled slots or a checksum also helps detect changes introduced by future compiler versions.

### TigerData — Formation performance telemetry

Store **what actually happened** in the simulation.

Encore's observer already measures coverage, priority-weighted coverage, geometric fidelity, score-version distributions, collisions, and message behaviour.

Attach the formation ID and run ID, and separately record model-generation and compilation latency.

A useful analytics view includes:

| Metric | Meaning |
|---|---|
| Formation generation | Gemini wall-clock latency |
| Compile time | Local geometry processing duration |
| Score adoption | Proportion that learned the new score |
| Slot coverage | Occupied target slots |
| Geometric fidelity | Match to dense intended geometry |
| Collision count | Runtime safety/performance outcome |
| Transition time | Scheduled vs actually observed arrival |
| Settling time | When drones meet position/velocity tolerance |

Illustrative dashboard values from the earlier explanation (not measured): **8.6 s** generation, **94%** adoption, **89%** coverage, **2** collisions.

**Adoption is not occupancy.** A drone can know the latest score while still travelling to its target. The hold-phase start tick likewise does not prove settling.

---

# Part VIII — Testing and Acceptance Criteria

## 12. How to know the approach works

Test model output quality, geometry validity, runtime behaviour, and user experience **separately**.

| Test | 2D target | 3D target |
|---|---|---|
| Valid structured JSON | High success rate | High success rate |
| Geometry validation | No invalid accepted contours | No invalid accepted solids |
| Exactly 200 slots | Required | Required |
| Minimum slot distance | >= 1.5 m | >= 1.5 m |
| World-space bounds | No violations | No violations |
| Recognizability | Clear from audience camera | Clear from reference and alternate cameras |
| Colour correctness | Consistent silhouette colour | Materials preserved |
| Deterministic replay | Identical ordered slots | Identical ordered slots |
| Flight completion | Measured occupancy and settling | Same |
| Offline replay | Required | Required |

These are **proposed acceptance criteria**, not claims that the current implementation has passed them.

### Realistic prompt test set

| Complexity | 2D | 3D |
|---|---|---|
| Very simple | Heart | Sphere |
| Simple | Rocket | Rocket |
| Medium | Butterfly | Stylized car |
| Complex | Elephant silhouette | Elephant head |
| Very complex | Lion with detailed mane | Full-body elephant |
| Unreasonable | Highly detailed photograph | Photorealistic dragon with textures |

The system should simplify or reject requests beyond its supported geometric/detail budget rather than claiming unlimited complexity.

### Measuring model quality

Record for each prompt:

1. Whether Gemini returned parseable/schema-valid JSON.
2. Whether the geometry passed bounds and other feasibility checks.
3. Whether 200 valid separated targets were produced.
4. Whether a human recognized the intended subject in the compiled point preview.
5. First-attempt generation wall-clock time, including any failures.
6. Whether and why regeneration was required.

Without an independent visual-evaluation model, geometric checks **cannot** establish recognizability on their own, especially for 3D animal anatomy.

---

# Part IX — Final Recommended Design

## 13. Implementation strategy

Build **two distinct geometric methods under one Gemini endpoint and one deterministic compiler interface**.

### 2D silhouette

```text
Gemini Flash-Lite
  → SceneSpec2D
  → Bézier/vector geometry
  → Silhouette mask
  → Boundary/interior/feature-aware sampling
  → 200 flat drone slots
```

**Strength:** Simpler and more reliable, especially for strong filled silhouettes and simple objects.

### 3D coloured

```text
Gemini Flash-Lite
  → SceneSpec3D
  → Parametric solid geometry
  → Coloured surface candidates
  → Visibility/feature-aware sampling
  → 200 genuine 3D drone slots
```

**Strength:** More technically ambitious and visually interesting, but accuracy and robustness are less predictable.

### Shared Encore runtime

```text
Validated formation
  → Preview
  → Operator score injection
  → Decentralized radio propagation
  → Drone transition
  → Hold and repair
```

The preview is the *ideal target arrangement*. The live swarm must still receive the score, move, avoid collisions as specified by its local controller, and settle.

### Final priorities

| Priority | Goal | Why |
|---|---|---|
| Essential | Reliable Flash-Lite-generated 2D silhouette | Clear demonstration of the central concept |
| Essential | Bounded 200-slot compiler | Prevent invalid formations |
| Essential | Preview before injection | Immediate feedback and opportunity to reject poor results |
| Essential | Genuine score dissemination and transition | Connect AI to Encore's main purpose |
| High | Coloured 3D parametric scenes | Additional technical ambition |
| High | MongoDB save/reload | Persistence and rate-limit resilience |
| High | TigerData real-run analytics | Evidence for performance claims |
| Optional | Automated visual-quality scoring | Additional evaluation complexity |
| Optional | Arbitrary detailed 3D assets | Beyond reliable primitive-based generation |
| Optional | Realistic packetization and advanced trajectory optimization | Significant scope increase |

---

## Overall verdict

**The strongest version of this project is not “Gemini generates an image and drones copy it.”**

It is:

> **Encore uses Gemini 3.1 Flash-Lite to translate natural-language descriptions into compact mathematical 2D and 3D scenes. A deterministic compiler converts those scenes into physically constrained coloured drone formations, which are then distributed and executed by Encore's decentralized swarm. MongoDB preserves the creations, while TigerData measures how successfully the swarm performs them.**

This gives each technology a meaningful role and avoids requiring any cloud service in the per-drone runtime.

The largest practical limitations are:

- Visual accuracy of model-described geometry, especially organic 3D subjects.
- The limited visual resolution of **200 separated lights**.
- Physical spacing and bounded-world constraints.
- Score propagation and flight-transition timing.
- API latency, free-tier limits, and potential regeneration.

The **2D mode is the reliable foundation**; the **coloured 3D mode is the additional innovation**. With explicit validation, previews, bounded compilation, offline replay, and honest telemetry, the architecture is well suited to a hackathon demonstration.
