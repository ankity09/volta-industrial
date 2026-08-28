# Plant Floor 3D — wow-factor tab (design)

Date: 2026-08-27
Status: Approved design (pending spec review)
App: `~/Desktop/Databricks/volta-industrial/app` (Databricks App, AppKit Node/Express + React/Vite)

## Problem & goal

Volta plant managers lack a live, consolidated view of machine health and failure
risk, and the nav-page brief names three pains — **visibility gaps**, **analysis
paralysis**, **manual execution** — culminating in the hero question: *"Line 4 is
trending toward a stop. Pull it now or run it to the end of the shift?"*

Goal: add a **dedicated "Plant Floor 3D" tab** that is the app's wow factor — a
full-screen, orbitable 3D factory where the worst lines are unmissable, each machine
shows **live Lakebase data on click**, and the view **bridges into the existing
Assist + Act loop** so it is not a dead-end demo.

## Decisions (locked with the user)

1. **Role:** dedicated nav tab (`/plant-floor-3d`), full-screen — not woven into
   other pages. Bridged back to the decision flow via click actions.
2. **Scene concept:** realistic **plant bays** (option A) — the manager recognizes
   their factory; critical lines glow and beam so you spot them across the room.
3. **Source of the visual:** **port the real PCC `scene.js`** (the rich digital-twin
   the user built — vanilla Three.js + CSS2D floating labels + per-machine status
   lights + click-to-telemetry callouts + animated conveyor flow), NOT the degraded
   233-line box-grid currently at `client/src/plantfloor/PlantFloor3D.tsx`. The PCC
   scene is already partially Volta-themed (`LINES_3D` uses PLANT-03/LINE-04 HERO;
   telemetry mapping `vacuum_torr→vibration mm/s`, `melt_temp_c→bearing temp`).
4. **Bay layout:** each bay a floor tile; lines as same-size cabinets in a grid,
   **color = risk band** (critical #E5484D + vertical beam, elevated/watch #FFB020,
   healthy #3C6997 dim). Machine type as a label, not geometry. All ~1,200 lines via
   `InstancedMesh` at 60fps; critical/elevated pop, healthy dim — true scale, eye
   still snaps to the ~90 that matter.
5. **On-load moment:** wide establishing shot of all bays → smooth camera fly-in +
   orbit to the single highest-`downtimeExposureUsd` critical line, which pulses, with
   a floating risk card (name, plant, machine type, failure %, $ exposure, part-local).
6. **Click action:** in-tab **slide-over panel** with live per-component data + two
   CTAs — "Ask the assistant about this line" (seeds the hero question in the chat
   dock) and "Open in Operations" (`/operations?line=LINE-XXXX`, the drawer already
   fixed).
7. **Per-component data:** the click callout/panel pulls the line's live **Lakebase**
   fields + candidate part from `/api/lines/:id` — `vibration_rms`, `temperature_c`,
   `failure_risk_score`, `downtime_exposure_usd`, open work orders, `part_local`,
   `lead_time_days`. Same governed data the assistant reasons over; one fetch per
   click; no new backend.

## Architecture

### Where it lives
- New route `{ path: '/plant-floor-3d', element: <PlantFloor3DView /> }` in
  `client/src/App.tsx`, and a nav item in `client/src/shell/AppSidebar.tsx`
  (icon e.g. `Box`/`Boxes` from lucide, label "Plant Floor 3D").
- New folder `client/src/plantfloor3d/` for the ported scene, kept separate from the
  legacy `client/src/plantfloor/` (which the Operations page still lazy-loads; see
  "Legacy component" below).

### Units (each with one clear purpose)
- **`PlantFloor3DView.tsx`** — the page/route. Owns: fetch `/api/lines` (all lines) +
  `/api/lines/summary`; mount the scene into a sized container; render the overlay UI
  (legend, filter buttons per plant/risk, search-to-focus, on-load risk card, the
  slide-over detail panel). Framework-agnostic wrapper around the vanilla scene.
- **`scene.js` (ported) → `scene.ts` or kept as JS module** — the PCC Three.js engine.
  Exposes an imperative API the React view drives: `init(container, opts)`,
  `setLines(lines)`, `focusLine(lineId)`, `onSelect(cb)`, `dispose()`. Internally
  unchanged in technique (buildLine, makeLabel/CSS2DObject, applyHealthToMachine,
  raycast pick, animation loop, UnrealBloom).
- **`lines-to-scene.ts`** — pure mapping from the app's `LineStatus[]` (`/api/lines`)
  to the scene's `LINES_3D` structure: group lines by `plantId` into 8 bays; within a
  bay, order lines; map `riskBand`→health color; map `machineType`→equipment model;
  mark the top-exposure line as hero. Testable in isolation.
- **`LineDetailPanel.tsx`** — the slide-over. Given a `lineId`, fetches `/api/lines/:id`
  and renders the live Lakebase card + the two CTAs. Reuses `fetchLine` from
  `client/src/lib/lines.ts` and `dockController.openAndSend` for the assistant CTA.

### Data flow
```
/api/lines  ─┐
             ├─► PlantFloor3DView (state: lines[], summary, selectedId)
/api/lines/summary ┘        │
                            ├─ lines-to-scene(lines) ─► scene.setLines(LINES_3D)
                            │                              │ (InstancedMesh, labels, beams)
                            │                              └─ on-load: scene.focusLine(topExposureLineId)
                            │
   user clicks a cabinet ──► scene.onSelect(lineId) ─► setSelectedId
                            │
              selectedId ──► LineDetailPanel ──► fetch /api/lines/:id (live Lakebase)
                                                   ├─ "Ask assistant" → dockController.openAndSend(heroQ)
                                                   └─ "Open in Operations" → navigate(/operations?line=…)

   agent writes a work order → existing dataMutated pub/sub → PlantFloint3DView refetches
      /api/lines → scene.setLines(...) → that line's color updates live (closed loop, in 3D)
```

### Live update (ties to the Act loop)
The app already has a `dataMutated` event (`client/src/lib/events.ts`) that fires when
the agent commits a work order. `PlantFloor3DView` subscribes to it and refetches
`/api/lines`, then calls `scene.setLines(...)` so a line that was just actioned changes
color/health in the 3D — the same closed-loop "watch the write land" the Operations
page has, now in the 3D tab.

## What we port vs. rebuild
- **Port from PCC `app/frontend/src/js/`:** `scene.js` (engine), the `vendor/` Three.js
  addons it uses (OrbitControls, EffectComposer, UnrealBloomPass, CSS2DRenderer, shaders),
  and the CSS for labels/callout cards. Adapt `LINES_3D` to Volta's 8 plants via the
  mapping module rather than hardcoding.
- **Rebuild/adapt:** the data source (PCC's `/telemetry/latest` → Volta's `/api/lines`),
  the per-component card fields (Volta Lakebase), and the two CTAs (Volta chat + drawer).
- **Do NOT touch:** `client/src/plantfloor/` (legacy box-grid) is left as-is for now so
  the Operations page's existing lazy import keeps building. (Follow-up option: point
  Operations at the new scene too, or remove the box-grid — out of scope here.)

## Bundling / build considerations
- The PCC scene is vanilla Three.js + JS `vendor/` addons. Vite/esbuild build already
  includes `three`. The `vendor/` addons (CSS2DRenderer etc.) are vendored copies; port
  them into `plantfloor3d/vendor/` and import directly (avoids the
  `three/examples/jsm/*` resolution issues the current box-grid has).
- CSS2DRenderer needs a sibling DOM layer over the WebGL canvas; the container must be
  explicitly sized (the current box-grid's zero-size bug came from an unsized parent —
  the new view gives the container a fixed `h-[calc(100vh-56px)]`).
- Lazy-load the whole tab (`React.lazy`) so the Three.js payload only loads on that route.

## Known pitfalls (from the current broken port — avoid repeating)
- `PCFShadowShadowMap` is a typo for `PCFSoftShadowMap` (crashes shadow setup).
- Container must have non-zero height before `renderer.setSize` (WebGL "zero size"
  framebuffer error). Size the container via CSS and read `clientWidth/Height` after mount.
- `three/examples/jsm/*` imports warned at build; vendored copies sidestep it.

## Testing / verification
- **Unit:** `lines-to-scene.ts` — given a known `LineStatus[]`, asserts 8 bays, correct
  hero (max exposure), correct color mapping, stable ordering.
- **Build:** `npm run build:source` clean (no PlantFloor3D warnings).
- **In-browser (deployed origin, Chrome DevTools MCP):** tab loads → establishing shot →
  fly-in to hero line + card; click a critical line → panel shows live Lakebase fields;
  "Ask the assistant" seeds the hero question; approve a work order in chat → the line's
  color updates in 3D on refetch. Screenshot each (a login card / blank canvas is not
  success — charts/cabinets must render).

## Out of scope (YAGNI)
- Live telemetry *series*/sparklines (needs an endpoint the app doesn't expose).
- Geospatial/map view of plants (`plantLat/Lng` exist on the type but unused).
- Replacing the Operations box-grid (separate follow-up).
- Multi-user real-time sync beyond the existing dataMutated refetch.
