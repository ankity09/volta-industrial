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
| `PlantFloor3DView.tsx` | **Meaningfully rewritten** (not just a fetch swap) — see "PlantFloor3DView changes" below. |
| `App.tsx`, `AppSidebar.tsx` | **Genuinely unchanged.** The route (`/plant-floor-3d`, lazy) and the sidebar nav item are already wired and are agnostic to what the view renders internally. Only the view's own internals change. |

**Retiring the v1 types (explicit):** the v1 model types in `plantfloor3d/scene.types.ts` — `SceneModel`, `BayModel`, `InstanceModel` — and the `SceneHandle.setLines` method are **retired and replaced** by the v2 types + `setPlant` below. Nothing outside `plantfloor3d/` depends on them: the legacy box-grid in `app/client/src/plantfloor/` has its OWN separate `types.ts` (that is the `RISK_BAND_HEX` source we import) and does not touch `plantfloor3d/`. So deleting the v1 types is safe; after the rewrite, `lines-to-scene.ts` is removed and no import of it or of `setLines`/`SceneModel` may remain.

### PlantFloor3DView changes (in-scope, explicit)
The v1 view fetched all lines once (`fetchLines({})`), filtered client-side, and offered an "All plants" option. v2 changes it to:
- **Required plant selection, no "All plants" option.** The dropdown lists PLANT-01..08 only; there is always exactly one selected plant. Default on first mount = the plant containing the global worst line (PLANT-01, which holds LINE-0031); this keeps the hero moment landing on load.
- **Per-plant fetch.** Fetch `fetchLines({ plant })` (~130-167 rows) on mount and whenever the selected plant changes; call `plantToScene(lines)` → `scene.setPlant(model)`.
- **Fly-in re-runs on every plant switch** (not only first load): each `setPlant` triggers establishing shot → fly-in to that plant's hero + callout.
- **Risk filter chips now dim within the current plant** (they no longer refetch or change plant): filtering re-derives which machines are de-emphasized, it does not leave the plant. Legend shows the current plant's counts.
- **`dataMutated`** refetches the CURRENT plant (not all lines) → `setPlant` (recolor/calm the actioned machine; no re-fly-in).
- Hero card + both CTAs (Ask assistant / Open in Operations) unchanged in behavior.

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
- **`setPlant(model)`:** the envelope (floor plate, walls, roof, window band, global lighting, crane) is built once and PERSISTS across plant switches. Each `setPlant` disposes ONLY the previous plant's per-plant content and rebuilds it. Concretely, switching PLANT-01 → PLANT-02 must `dispose()` the 6 neighborhood machine groups + their moving parts + their critical particle systems + the district CSS2D labels + the previous callout, but must NOT touch the floor, walls, roof, lighting, or crane. Then build 6 neighborhood districts (floor tint + CSS2D label per type present); for each machine call `buildMachine(type, riskBand)` from `machines.ts`, place it in its neighborhood grid at `(x, z)`, register pick target → lineId, and store its `animate` handle. Cache the hero's machine for the pulse/beacon. (This is the same "fully dispose the previous plant's machines/labels/particles" the Known-Pitfalls section requires — envelope excepted because it is not per-plant.)
- **Motion (risk-driven):** in the animation loop, call each machine's `animate(t, state)`. Healthy = quiet idle (slow ram, slow arm sweep, spinning fan/spindle). Critical = dramatic (hammer stroke, arc-flash point-light + spark burst, spark stream, emissive pulse) + a rotating beacon. Particle systems (sparks/arc/mist) are created ONLY for critical machines (~10-12/plant) to stay in budget. Reduced-motion: skip idle + dramatic motion; keep camera + a static critical glow.
- **Raycast pick:** machines are Groups (not one instanced mesh now); raycast against a per-machine pickable body, map hit → lineId, fire `onSelect`. Hover raises the machine slightly + cursor pointer.
- **Floating callout:** exactly ONE in-scene CSS2D telemetry card + leader line is visible at a time, attached to the currently focused machine (vibration, bearing temp, failure %, $ exposure), mirroring PCC. Lifecycle: appears on the plant hero after the on-load fly-in completes; moves to a clicked machine on select; on plant switch it disappears and re-appears on the new plant's hero after that fly-in. It is layered on top of (and independent of) the React slide-over panel.
- **Camera choreography:** on `setPlant`, wide establishing shot → eased fly-in orbit to the plant hero (pulsing, beacon on) + callout. Plant switch re-runs the beat. (Camera tween already exists; this wires it to the per-plant hero.)

### Perf strategy (one plant, ~150 machines, 60fps)
Share one geometry + material per (machineType, riskBand) combo; merge each machine's static parts so a machine is ~2-3 draw calls; moving parts are cheap transforms (translate/rotate); allocation-free animation loop (reuse dummies/vectors); particle systems only on critical machines. Rough budget: ~150 machines x ~3 draw calls ≈ 450 draw calls + ~12 particle systems + envelope, comfortably within a 60fps frame on integrated-GPU-class hardware (PCC ran comparable detail on the same engine family; v1 ran 1,200 instances fine). Target 60fps on the presenter's laptop; if a low-end GPU struggles, the reduced-motion branch already drops particles + bloom. Consider `InstancedMesh` per (type,riskBand) if profiling shows draw calls dominate, but do not pre-optimize — start with grouped Groups for animation simplicity.

## What we reuse vs. rebuild
- **Reuse:** `fetchLines({plant})` / `fetchLine` (`lib/lines.ts`), `RISK_BAND_HEX` (`plantfloor/types`), `RiskBandBadge` (`shared/badges`), `dockController.openAndSend`, `dataMutated`, `LineDetailPanel.tsx`, the `/operations?line=` deep link, and the v1 engine's renderer/bloom/controls/CSS2D/dispose/reduced-motion scaffolding.
- **Rebuild:** the scene content (envelope + 6 procedural machines + neighborhoods + motion + callout), the mapping (`lines-to-scene.ts` → `plant-to-scene.ts`), and the view's data-binding (all-lines-with-filter → required-per-plant, dropdown as primary nav — see "PlantFloor3DView changes").
- **Retire:** the v1 `plantfloor3d/scene.types.ts` types (`SceneModel`, `BayModel`, `InstanceModel`) and `SceneHandle.setLines`, replaced by the v2 types + `setPlant`; delete `lines-to-scene.ts` and its test. (Not to be confused with the legacy folder below — this is only within `plantfloor3d/`.)
- **Do NOT touch:** legacy `app/client/src/plantfloor/` box-grid (Operations still lazy-imports it; it has its own `types.ts`, unrelated to `plantfloor3d/`).

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
- **In-browser (deployed origin, Chrome DevTools MCP):** select a plant → detailed shop floor renders (recognizable machines + factory envelope + neighborhood labels + painted aisles), NOT boxes; establishing shot → fly-in to the plant's worst line + floating callout; critical machines throw sparks/arc + beacon while healthy idle; click a machine → the slide-over shows live Lakebase fields + both CTAs work (Ask assistant seeds hero Q into the dock; Open in Operations deep-links); switch plants in the dropdown a few times → floor re-renders for the new plant each time and the fly-in + callout re-run; approve a work order in chat → that machine recolors/calms on the `dataMutated` refetch. Screenshot each; a blank canvas / boxes / login card / console error is not success.
- **No-leak check:** switch plants repeatedly (e.g. cycle all 8) and confirm the WebGL context does not warn about too many contexts and memory stays bounded — verifies each `setPlant` disposes the previous plant's machines/labels/particles (envelope excepted) and `dispose()` on unmount fully tears down.

## Out of scope (YAGNI)
- Rendering all 8 plants at once (explicitly replaced by one-plant-at-a-time).
- Inter-neighborhood conveyors (cut; not physically meaningful for type-clustered districts).
- GLTF/CAD photoreal models (procedural only).
- In-scene telemetry sparklines/time series beyond the callout's current values (no endpoint).
- Geospatial map, multi-user sync beyond `dataMutated`, replacing the legacy Operations box-grid.
