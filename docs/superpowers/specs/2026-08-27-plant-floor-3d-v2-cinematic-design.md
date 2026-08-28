# Plant Floor 3D v2 — cinematic single-plant (design)

Date: 2026-08-27
Status: Approved design (pending spec review)
App: `~/Desktop/Databricks/volta-industrial/app` (Databricks App, AppKit Node/Express + React/Vite)
Supersedes: the v1 8-bay instanced-box scene from `2026-08-27-plant-floor-3d-tab-design.md` (shipped, verified, but reads as "boxes on a plane")

## Problem & goal

The shipped Plant Floor 3D tab renders all ~1,200 lines as one instanced box repeated across 8 flat bays. The live data and the click-to-detail panel are correct and good, but the **scene itself conveys no value**: it looks like boxes on a plane, not a factory. The reference the user built (PCC Foundry twin) felt rich because it had ~30 procedural detail systems (8 distinct machine types with moving parts, a factory envelope, conveyors, particle systems, telemetry callouts). Ours has one box.

Goal: rebuild the scene so it reads as a **real, cinematic factory floor** and shows real value at a glance, while staying on the app's bundled `three@0.169` ESM and reusing the existing data + panel + CTA seams.

## Decisions (locked with the user during brainstorming)

1. **North star: cinematic realism** — it should look like the customer's actual plant (distinct machine geometry, a factory environment, lighting, motion), not an abstract data viz.
2. **One plant at a time, selected from the dropdown** — do NOT render all 1,200 lines at once. Render a single plant (~130-167 machines) as a detailed shop floor; the plant `<select>` becomes the primary navigation. This removes the 1,200-machine perf ceiling and is what makes real per-machine detail affordable at 60fps.
3. **Layout: machine-type neighborhoods** — within the selected plant, machines group into 6 labeled districts by `machineType` (Press Shop, Weld Bay, CNC Row, Robot Cell, Grind Line, Molding). Reads like walking a real facility and turns the 6 types into legible districts (vs. a uniform grid or process aisles).
4. **Build approach: procedural machines in Three.js** — 6 builder functions assemble primitives into recognizable machines with named moving parts (the PCC technique). No GLTF/CAD import (asset licensing, payload, rigging, no loader vendored = too heavy/risky for the timeline). No hybrid GLTF-slot indirection (YAGNI; easy to add later if ever needed).
5. **Liveness: risk-driven** — healthy machines run a quiet idle cycle; CRITICAL machines are dramatic (sparks / arc-flash / hammering + a rotating warning beacon + emissive pulse) so the motion itself points the eye at what is failing. Best signal-to-noise and GPU-friendly.
6. **Scope calls:** keep a slow overhead crane for ambient depth; CUT inter-neighborhood conveyors (neighborhoods are type-clustered, not a process line, so belts between them are not physically meaningful; aisles + striping give the industrial read). Build all 6 machine types (every plant contains all 6 types).

## Data facts (verified against live Lakebase this session)

- 8 plants `PLANT-01`..`PLANT-08`; per-plant line counts 130-167 (so one plant is ~130-167 machines, NOT 1,200).
- 6 machine types: `Hydraulic_Press, Assembly_Robot, Welding_Cell, CNC_Mill, Grinder, Injection_Molder`. Each Volta "line" is one machine of one type.
- Every plant contains all 6 types (types are spread across plants).
- Risk split overall: 1045 healthy / 90 critical / 61 watch / 4 elevated. So a typical plant has roughly ~10-12 critical machines — the dramatic few among the calm many.
- Top downtime exposure is a 5-way tie at $41,800; the global worst line (deterministic tiebreak) is `LINE-0031` in `PLANT-01` (Grinder, 95%). This drives the default plant selection.
- `GET /api/lines?plant=PLANT-0X` returns just that plant's lines (the `plant` filter already exists and is server-side). `GET /api/lines/:id` returns the snake_case `LineDetail`. No new backend needed.

## Architecture

### The core shift
v1 fetched all 1,200 lines and rendered one instanced box mesh across 8 bays. v2 fetches ONE plant's lines and renders a detailed shop floor of procedural machines grouped into 6 type-neighborhoods. The plant dropdown is the primary control (a required selection, not an optional filter).

### Where it lives (evolve the existing `app/client/src/plantfloor3d/`, do not start a new folder)

| File | Change |
|---|---|
| `scene.types.ts` | Extend with the v2 model types (below). Retire the v1 instanced types (`InstanceModel`, `BayModel`, `SceneModel`) once nothing imports them. |
| `plant-to-scene.ts` | NEW pure module (replaces `lines-to-scene.ts`). Given ONE plant's `LineStatus[]`, produce a `PlantSceneModel`: group by `machineType` into 6 `NeighborhoodModel`s, lay out each neighborhood's machines in a grid within its district, pick the plant hero (max downtime exposure, deterministic tiebreak), map `riskBand`→color + animation state. No Three, no React, no fetch. Unit-tested. |
| `scene.ts` | MAJOR rewrite (the bulk of the work). See "Scene engine" below. Keeps the same imperative-handle shape but the methods change: `setPlant(model)` replaces `setLines(model)`. |
| `machines.ts` | NEW. The 6 procedural machine builder functions + a dispatcher `buildMachine(type, riskBand) → { group, moving parts, animate(t, state) }`. Kept separate from `scene.ts` so each builder is focused and the engine file does not balloon. |
| `LineDetailPanel.tsx` | Unchanged (works well; reads snake_case `LineDetail`). |
| `PlantFloor3DView.tsx` | Data fetch becomes per-plant; dropdown becomes primary nav (required, defaults to the plant containing the global worst line); filter chips dim within the current plant; `dataMutated` refetches the current plant. |
| `App.tsx`, `AppSidebar.tsx` | Unchanged (route + nav item already wired). |

### v2 model types (in `scene.types.ts`)
- `MachineType = 'Hydraulic_Press' | 'Assembly_Robot' | 'Welding_Cell' | 'CNC_Mill' | 'Grinder' | 'Injection_Molder'` (from the data's literal values).
- `MachineModel` — `{ lineId, lineName, machineType, riskBand, failureRiskScore, downtimeExposureUsd, x, z, colorHex, emphasized }` (position within the plant; one per line).
- `NeighborhoodModel` — `{ machineType, label, centerX, centerZ, halfW, halfD, machineCount, criticalCount }` (a labeled district).
- `PlantSceneModel` — `{ plantId, neighborhoods: NeighborhoodModel[], machines: MachineModel[], heroLineId: string | null, counts: SceneCounts }`.
- `SelectPayload` — unchanged.
- `SceneHandle` — `{ setPlant(model), focusLine(lineId), onSelect(cb), resize(), dispose() }` (`setPlant` replaces `setLines`).
- `SceneOptions` — unchanged (`reducedMotion`).

### Data flow
```
plant <select> (default = plant of global worst line)
      │
      ├─ fetchLines({ plant })  ──► plantToScene(lines) ──► scene.setPlant(model)
      │        (~150 rows)                                     │ (envelope reused; machines rebuilt)
      │                                                        └─ on load / on plant change:
      │                                                           establishing shot → fly-in to plant hero + callout
      │
   click a machine ──► scene.onSelect(lineId) ──► setSelectedId
      │                                             ├─ LineDetailPanel (existing, /api/lines/:id)
      │                                             └─ in-scene floating callout on that machine
      │
   agent writes a work order ──► dataMutated ──► refetch fetchLines({ plant }) ──► scene.setPlant(...)
                                                   (that machine recolors + calms; no re-fly-in)
```

### Scene engine (`scene.ts`)
Keeps the v1 setup that works (renderer w/ `PCFSoftShadowMap`, `outputColorSpace = SRGBColorSpace`, `three/addons/*` imports, UnrealBloom composer + `OutputPass`, OrbitControls, CSS2D overlay, eased camera tween, full `dispose()` incl. `forceContextLoss()` + InstancedMesh disposal, reduced-motion branch). New responsibilities:

- **Factory envelope (built once, persists across plant switches):** floor plate with painted safety aisles between neighborhoods + faint diamond-plate texture; perimeter walls + roof trusses + a faintly-lit window band; industrial lighting (cool hemisphere ambient + warm work-lights) on top of the existing bloom. Line-ID stencils on the floor under each machine.
- **`setPlant(model)`:** dispose only the previous plant's machine groups + district labels (NOT the envelope); build 6 neighborhood districts (floor tint + CSS2D label per type present); for each machine call `buildMachine(type, riskBand)` from `machines.ts`, place it in its neighborhood grid at `(x, z)`, register pick target → lineId, and store its `animate` handle. Cache the hero's machine for the pulse/beacon.
- **Motion (risk-driven):** in the animation loop, call each machine's `animate(t, state)`. Healthy = quiet idle (slow ram, slow arm sweep, spinning fan/spindle). Critical = dramatic (hammer stroke, arc-flash point-light + spark burst, spark stream, emissive pulse) + a rotating beacon. Particle systems (sparks/arc/mist) are created ONLY for critical machines (~10-12/plant) to stay in budget. Reduced-motion: skip idle + dramatic motion; keep camera + a static critical glow.
- **Raycast pick:** machines are Groups (not one instanced mesh now); raycast against a per-machine pickable body, map hit → lineId, fire `onSelect`. Hover raises the machine slightly + cursor pointer.
- **Floating callout:** the focused machine (hero on load, or clicked) gets a CSS2D telemetry card + leader line (vibration, bearing temp, failure %, $ exposure) in-scene, mirroring PCC. Layered on top of the React slide-over.
- **Camera choreography:** on `setPlant`, wide establishing shot → eased fly-in orbit to the plant hero (pulsing, beacon on) + callout. Plant switch re-runs the beat. (Camera tween already exists; this wires it to the per-plant hero.)

### Perf strategy (one plant, ~150 machines, 60fps)
Share one geometry + material per (machineType, riskBand) combo; merge each machine's static parts so a machine is ~2-3 draw calls; moving parts are cheap transforms (translate/rotate); allocation-free animation loop (reuse dummies/vectors); particle systems only on critical machines. This is well within budget (PCC ran comparable detail on the same engine family). If a low-end GPU struggles, the reduced-motion branch already drops particles + bloom.

## What we reuse vs. rebuild
- **Reuse:** `fetchLines({plant})` / `fetchLine` (`lib/lines.ts`), `RISK_BAND_HEX` (`plantfloor/types`), `RiskBandBadge` (`shared/badges`), `dockController.openAndSend`, `dataMutated`, `LineDetailPanel.tsx`, the `/operations?line=` deep link, and the v1 engine's renderer/bloom/controls/CSS2D/dispose/reduced-motion scaffolding.
- **Rebuild:** the scene content (envelope + 6 procedural machines + neighborhoods + motion + callout), the mapping (`lines-to-scene.ts` → `plant-to-scene.ts`), and the view's fetch (all-lines → per-plant, dropdown as primary nav).
- **Do NOT touch:** legacy `app/client/src/plantfloor/` box-grid (Operations still lazy-imports it).

## Bundling / build considerations
- Still pure `three@0.169` ESM + `three/addons/*` (OrbitControls, CSS2DRenderer, EffectComposer, RenderPass, UnrealBloomPass, OutputPass). No new deps, no GLTF loader.
- Procedural geometry only → no asset payloads bundled into the App.
- Tab stays `React.lazy` so the Three.js payload only loads on this route.

## Known pitfalls (carry forward from v1 — do not regress)
- `PCFSoftShadowMap` (not the `PCFShadowShadowMap` typo). `outputColorSpace = SRGBColorSpace` / `OutputPass` (NOT the removed r128 `outputEncoding`/`sRGBEncoding`). Import addons from `three/addons/*` (NOT `three/examples/jsm/*`, which warns).
- Container must have non-zero height before `renderer.setSize` (read `clientWidth/Height` with fallback).
- CSS2D overlay is a sibling DOM layer over the canvas, `pointer-events:none`.
- `dispose()` must fully tear down (RAF, listeners, geometries/materials, particle systems, CSS2D nodes, `renderer.dispose()` + `forceContextLoss()`, both canvases). React 18 StrictMode double-mounts + lazy route mount/unmount. Guard handle methods after dispose.
- Envelope persists across plant switches, but each `setPlant` must fully dispose the PREVIOUS plant's machines/labels/particles or repeated plant switches leak GPU memory.
- Run npm/vitest/build from `app/`; unit tests are `*.test.ts` (vitest excludes `*.spec.ts`, env=node); `@` → `app/client/src`. `build:source` is the real gate (repo has a pre-existing broken `tsc -b` baseline + broken eslint config, both unrelated).

## Testing / verification
- **Unit (`plant-to-scene.test.ts`):** given one plant's `LineStatus[]` → 6 neighborhoods (one per type present), one machine per line, correct hero = plant's max exposure with the deterministic tiebreak (exposure desc → failureRiskScore desc → lineId asc), risk→color + emphasized mapping, stable machine layout across refetches (so live recolor doesn't reshuffle), counts correct, empty-plant + single-type edge cases.
- **Build:** `npm run build:source` clean; no `three/examples/jsm` warning; Three.js payload still code-split to the route.
- **In-browser (deployed origin, Chrome DevTools MCP):** select a plant → detailed shop floor renders (recognizable machines + factory envelope + neighborhood labels + painted aisles), NOT boxes; establishing shot → fly-in to the plant's worst line + floating callout; critical machines throw sparks/arc + beacon while healthy idle; click a machine → the slide-over shows live Lakebase fields + both CTAs work (Ask assistant seeds hero Q into the dock; Open in Operations deep-links); switch plants in the dropdown → floor re-renders for the new plant; approve a work order in chat → that machine recolors/calms on the `dataMutated` refetch. Screenshot each; a blank canvas / boxes / login card / console error is not success.

## Out of scope (YAGNI)
- Rendering all 8 plants at once (explicitly replaced by one-plant-at-a-time).
- Inter-neighborhood conveyors (cut; not physically meaningful for type-clustered districts).
- GLTF/CAD photoreal models (procedural only).
- In-scene telemetry sparklines/time series beyond the callout's current values (no endpoint).
- Geospatial map, multi-user sync beyond `dataMutated`, replacing the legacy Operations box-grid.
