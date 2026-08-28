# Plant Floor 3D v2 (Cinematic Single-Plant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Plant Floor 3D tab so it renders ONE plant at a time as a detailed, cinematic factory floor — 6 procedural machine types grouped into type-neighborhoods, a factory envelope, risk-driven motion (healthy idle, critical sparks/beacon/pulse), and a floating telemetry callout — replacing the v1 "1,200 instanced boxes across 8 bays" scene that reads as boxes on a plane.

**Architecture:** The plant `<select>` becomes primary navigation: choosing a plant fetches just that plant's ~130-167 lines (`fetchLines({plant})`), a pure mapper (`plant-to-scene.ts`) groups them by `machineType` into 6 neighborhood districts and lays out one machine per line, and the vanilla-Three engine (`scene.ts`, driven by `setPlant`) builds a persistent factory envelope once + rebuilds the per-plant machines/labels/particles on each plant switch. Six procedural machine builders live in `machines.ts`. The existing data helpers, `LineDetailPanel`, chat/Operations CTAs, `dataMutated` loop, and the engine's renderer/bloom/controls/CSS2D/dispose/reduced-motion scaffolding are reused. Built on the app's bundled `three@0.169` ESM (`three/addons/*`).

**Tech Stack:** React 18 + react-router 7, TypeScript strict, Vite 6 / esbuild, `three@0.169.0` (ESM) + `three/addons/*` (OrbitControls, CSS2DRenderer, EffectComposer, RenderPass, UnrealBloomPass, OutputPass), Vitest 2 (node env, `@`→`client/src`), Tailwind 4, lucide-react, `@databricks/appkit-ui`. Databricks App (AppKit Node/Express + Vite client), Lakebase Postgres.

---

## Context the implementer needs (read before Task 1)

**This is a v2 rewrite of a SHIPPED, DEPLOYED, graded feature. Do not break the app.** Spec: `docs/superpowers/specs/2026-08-27-plant-floor-3d-v2-cinematic-design.md`. The v1 plan (`2026-08-27-plant-floor-3d-tab.md`) shipped the current scene; v2 replaces its scene content.

- **Repo/branch:** `~/Desktop/Databricks/volta-industrial`, branch `build/volta-app`, app under `app/`. Current HEAD `4ff479a`. Run all npm/vitest/build commands from **`app/`** (no `app/client/package.json`; `@`→`app/client/src`).
- **`three@0.169.0` + `@types/three@0.169` already installed.** Import addons from **`three/addons/*`** (NOT `three/examples/jsm/*` — warns). r169 API: `renderer.outputColorSpace = THREE.SRGBColorSpace`, `renderer.shadowMap.type = THREE.PCFSoftShadowMap` (NOT the `PCFShadowShadowMap` typo), `OutputPass` as final composer pass (NOT the removed `outputEncoding`/`sRGBEncoding`/GammaCorrectionShader).
- **Current `app/client/src/plantfloor3d/` files (v1, as of HEAD):**
  - `scene.types.ts` (80 lines) — has v1 types `InstanceModel`, `BayModel`, `SceneModel`, `SceneCounts`, `SelectPayload`, `SceneHandle` (with `setLines`), `SceneOptions`. **v2 extends/retires these.**
  - `lines-to-scene.ts` (143 lines) + `__tests__/lines-to-scene.test.ts` (121 lines) — v1 pure mapper (8 bays, instanced). **Deleted in v2, replaced by `plant-to-scene.ts`.**
  - `scene.ts` (661 lines) — v1 engine (instanced boxes + beams). **Major rewrite.** KEEP its working scaffolding: renderer/camera/controls/CSS2D/bloom setup, `easeInOutCubic`/`clamp`/`stepCamTween`, `disposeMeshResources` helper, `resize()`, `dispose()` (incl. `forceContextLoss()`), reduced-motion branch, raycast NDC math. REPLACE its content-building (`setLines`, box + beam meshes) with the v2 envelope + machines + neighborhoods.
  - `LineDetailPanel.tsx` (215 lines) — **UNCHANGED.** Reads snake_case `LineDetail`.
  - `PlantFloor3DView.tsx` (379 lines) — **rewritten** data-binding (per-plant fetch, required dropdown). Keep its overlay chrome (legend, hero card, search, orbit hint, `LineDetailPanel` mount) adapted.
- **Data contract (`app/client/src/shared/types.ts`):** `LineStatus` (camelCase: `lineId, plantId, lineName, machineType, riskBand, failureRiskScore, downtimeExposureUsd, vibrationRms, temperatureC, partLocal, ...`). `LineDetail` (snake_case, from `/api/lines/:id`). `RiskBand = 'critical'|'elevated'|'watch'|'healthy'`.
- **Live data (verified):** 8 plants `PLANT-01..08`, per-plant 130-167 lines, 6 machine types `Hydraulic_Press, Assembly_Robot, Welding_Cell, CNC_Mill, Grinder, Injection_Molder`. Every plant has all 6 types. Global worst line (deterministic tiebreak exposure→failureRisk desc→lineId asc) = `LINE-0031` in `PLANT-01`. `GET /api/lines?plant=PLANT-0X` returns just that plant's rows (server-side filter confirmed in `maintenance.ts` `listLines`).
- **Reuse (do NOT rebuild):** `fetchLines({plant})` / `fetchLine` (`@/lib/lines`), `RISK_BAND_HEX` (`@/plantfloor/types`), `RiskBandBadge` (`@/shared/badges`), `dockController.openAndSend` (`@/chat/dockController`), `dataMutated` (`@/lib/events`), `LineDetailPanel`, `/operations?line=` deep-link.
- **Do NOT touch** `app/client/src/plantfloor/` (legacy box-grid; Operations lazy-imports it; it has its OWN `types.ts`). `App.tsx` + `AppSidebar.tsx` stay unchanged (route + nav already wired, agnostic to view internals).
- **Build/test facts:** vitest `environment: 'node'`, `globals: true`, excludes `*.spec.ts` → name tests `*.test.ts`, keep them pure (no WebGL/DOM). Repo has a PRE-EXISTING broken `tsc -b` baseline + broken eslint (`typescript-eslint` missing) — NOT ours. **`npm run build:source` is the real gate** (client Vite + server esbuild). Verify new files typecheck clean by scoping `npm run typecheck` output to `plantfloor3d/`.
- **Style:** no em dashes in UI copy; dark theme tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `var(--brand-*)`); Fortune-500 polish. Reference look: `~/Desktop/Databricks/pcc-3d-scene.png` (dark room, colored districts, floating labels).
- **PCC source to study for procedural technique (read-only, r128 global style — do NOT copy verbatim, adapt to r169 ESM):** `~/Desktop/Databricks/pcc-foundry-digital-twin/app/frontend/src/js/scene.js` has `buildFurnace/buildPress/buildSwage/buildBooth/...` (lines ~223-478), `buildFloor`/`buildEnvelope`/`setupEnvironment` (~519-805), particle pools (~881-940), crane (~966), callout (~1037-1125). Use these as a reference for HOW to assemble primitives + moving parts, not as code to paste.

**Deploy (Task 8):** `cd app && export DATABRICKS_CONFIG_PROFILE=fe-sandbox-predictive-maintainers && ./scripts/deploy.sh` (backgrounded, several min; auto-runs the Bug-D Lakebase re-grant). App: `volta-plant-floor`, URL `https://volta-plant-floor-7474647707959925.aws.databricksapps.com/plant-floor-3d`. Verify in Chrome DevTools MCP (own profile; SSO-gated so pause for the user to log in; kill orphaned `chrome-devtools-mcp/chrome-profile` PID if "already running").

---

## File Structure

| File | Responsibility |
|---|---|
| `plantfloor3d/scene.types.ts` | **Edit.** Add v2 types: `MachineType`, `MachineModel`, `NeighborhoodModel`, `PlantSceneModel`. Change `SceneHandle.setLines`→`setPlant(model: PlantSceneModel)`. Remove v1 `InstanceModel`/`BayModel`/`SceneModel`. Keep `SceneCounts`, `SelectPayload`, `SceneOptions`. |
| `plantfloor3d/plant-to-scene.ts` | **New (replaces `lines-to-scene.ts`).** Pure: one plant's `LineStatus[]` → `PlantSceneModel` (6 neighborhoods by machineType, one machine per line laid out in each district grid, deterministic plant hero, risk→color/emphasis). Unit-tested. |
| `plantfloor3d/machines.ts` | **New.** 6 procedural machine builders + `buildMachine(type, riskBand)` dispatcher returning `{ group, animate(t, phase, opts), dispose() }`. Pure Three.js, no data deps. |
| `plantfloor3d/scene.ts` | **Rewrite content.** Keep renderer/controls/bloom/CSS2D/camera-tween/resize/dispose/reduced-motion scaffolding. Add persistent envelope, `setPlant` (build neighborhoods + machines via `machines.ts`), risk-driven animation loop, floating callout, per-plant dispose. |
| `plantfloor3d/PlantFloor3DView.tsx` | **Rewrite data-binding.** Required plant dropdown (default PLANT-01), per-plant fetch, `plantToScene`→`setPlant`, fly-in per plant switch, chips dim within plant, `dataMutated` refetch current plant. Keep overlay chrome + panel. |
| `plantfloor3d/lines-to-scene.ts` + its test | **Delete.** |
| `plantfloor3d/LineDetailPanel.tsx`, `App.tsx`, `AppSidebar.tsx` | **Unchanged.** |

Task order is dependency-driven: types → pure mapper (tested) → machine builders → engine → view → cleanup → build → deploy/verify.

---

## Task 1: v2 scene types

**Files:**
- Modify: `app/client/src/plantfloor3d/scene.types.ts`

- [ ] **Step 1: Rewrite `scene.types.ts`** to the v2 shape

```typescript
/**
 * Shared shapes for the Plant Floor 3D tab (v2 — cinematic single-plant).
 * The pure mapper (plant-to-scene.ts) produces a PlantSceneModel; the vanilla
 * Three engine (scene.ts) consumes it via setPlant(); the React view drives both.
 * Dependency-free so the mapper stays unit-testable in the node env.
 */
import type { RiskBand } from '@/shared/types';

/** The 6 machine types in the data (literal values of LineStatus.machineType). */
export type MachineType =
  | 'Hydraulic_Press'
  | 'Assembly_Robot'
  | 'Welding_Cell'
  | 'CNC_Mill'
  | 'Grinder'
  | 'Injection_Molder';

/** One production line = one machine, placed within its neighborhood. */
export interface MachineModel {
  lineId: string;
  lineName: string;
  machineType: MachineType;
  riskBand: RiskBand;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  /** World position on the floor (y is fixed per machine type). */
  x: number;
  z: number;
  /** 0xRRGGBB from RISK_BAND_HEX. */
  colorHex: number;
  /** critical|elevated → dramatic motion + pop; watch|healthy → quiet idle. */
  emphasized: boolean;
}

/** One machine-type district on the floor. */
export interface NeighborhoodModel {
  machineType: MachineType;
  label: string; // e.g. "Press Shop"
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  machineCount: number;
  criticalCount: number;
}

export interface SceneCounts {
  total: number;
  critical: number;
  elevated: number;
  watch: number;
  healthy: number;
}

/** The whole model for ONE plant. */
export interface PlantSceneModel {
  plantId: string;
  neighborhoods: NeighborhoodModel[];
  machines: MachineModel[];
  /** The line the camera flies to on load. Null only if the plant has 0 lines. */
  heroLineId: string | null;
  counts: SceneCounts;
}

export interface SelectPayload {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: MachineType;
  riskBand: RiskBand;
}

export interface SceneHandle {
  setPlant(model: PlantSceneModel): void;
  focusLine(lineId: string): void;
  onSelect(cb: (payload: SelectPayload) => void): void;
  /** Dim machines whose band !== the active one; 'all' restores full. */
  highlightRisk(band: RiskBand | 'all'): void;
  resize(): void;
  dispose(): void;
}

export interface SceneOptions {
  reducedMotion?: boolean;
}
```

- [ ] **Step 2: Typecheck the file in isolation**

Run (from `app/`): `npm run typecheck 2>&1 | grep scene.types` → expect no output (clean). (Other files still referencing v1 types will error until later tasks; that's expected mid-rewrite — do not fix them here.)

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/scene.types.ts
git commit -m "feat(plantfloor3d): v2 scene types (MachineModel/NeighborhoodModel/PlantSceneModel)

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 2: Pure mapper `plant-to-scene.ts` (TDD)

The testable core: one plant's lines → neighborhoods + placed machines + hero. No Three, no React.

**Files:**
- Create: `app/client/src/plantfloor3d/plant-to-scene.ts`
- Test: `app/client/src/plantfloor3d/__tests__/plant-to-scene.test.ts`
- Delete (Task 7, not here): `lines-to-scene.ts` + its test.

- [ ] **Step 1: Write the failing test**

```typescript
// app/client/src/plantfloor3d/__tests__/plant-to-scene.test.ts
import { describe, it, expect } from 'vitest';
import { plantToScene } from '../plant-to-scene';
import type { LineStatus, RiskBand } from '@/shared/types';
import type { MachineType } from '../scene.types';

function line(over: Partial<LineStatus> & { lineId: string; machineType: MachineType }): LineStatus {
  return {
    plantId: 'PLANT-01',
    lineName: over.lineId,
    criticality: 'high',
    plantLat: 0, plantLng: 0, vibrationRms: 0, temperatureC: 0, utilizationPct: 0,
    failureRiskScore: 0, openWoCount: 0, hasOpenCorrective: false,
    candidatePartId: null, partLocal: false, partUnitCostUsd: null, partLeadTimeDays: null,
    riskSignalScore: null, downtimeExposureUsd: 0, riskBand: 'healthy' as RiskBand,
    ...over,
  };
}

describe('plantToScene', () => {
  it('creates one neighborhood per distinct machineType present', () => {
    const m = plantToScene([
      line({ lineId: 'a', machineType: 'Hydraulic_Press' }),
      line({ lineId: 'b', machineType: 'Hydraulic_Press' }),
      line({ lineId: 'c', machineType: 'CNC_Mill' }),
    ]);
    expect(m.neighborhoods).toHaveLength(2);
    expect(m.neighborhoods.map((n) => n.machineType).sort()).toEqual(['CNC_Mill', 'Hydraulic_Press']);
    expect(m.neighborhoods.find((n) => n.machineType === 'Hydraulic_Press')!.machineCount).toBe(2);
  });

  it('produces one machine per input line, tagged with type + position', () => {
    const m = plantToScene([
      line({ lineId: 'a', machineType: 'Grinder' }),
      line({ lineId: 'b', machineType: 'Welding_Cell' }),
    ]);
    expect(m.machines).toHaveLength(2);
    for (const mc of m.machines) {
      expect(typeof mc.x).toBe('number');
      expect(typeof mc.z).toBe('number');
    }
  });

  it('has a human label per neighborhood', () => {
    const m = plantToScene([line({ lineId: 'a', machineType: 'Hydraulic_Press' })]);
    expect(m.neighborhoods[0].label).toBe('Press Shop');
  });

  it('maps riskBand to RISK_BAND_HEX and sets emphasized for critical/elevated only', () => {
    const m = plantToScene([
      line({ lineId: 'c', machineType: 'Grinder', riskBand: 'critical' }),
      line({ lineId: 'e', machineType: 'Grinder', riskBand: 'elevated' }),
      line({ lineId: 'w', machineType: 'Grinder', riskBand: 'watch' }),
      line({ lineId: 'h', machineType: 'Grinder', riskBand: 'healthy' }),
    ]);
    const by = (id: string) => m.machines.find((x) => x.lineId === id)!;
    expect(by('c').colorHex).toBe(0xe5484d);
    expect(by('h').colorHex).toBe(0x3c6997);
    expect(by('c').emphasized).toBe(true);
    expect(by('e').emphasized).toBe(true);
    expect(by('w').emphasized).toBe(false);
    expect(by('h').emphasized).toBe(false);
  });

  it('picks hero = max exposure, tiebroken by failureRiskScore desc then lineId asc', () => {
    const m = plantToScene([
      line({ lineId: 'LINE-0317', machineType: 'Welding_Cell', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.8 }),
      line({ lineId: 'LINE-0031', machineType: 'Grinder', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
      line({ lineId: 'LINE-0122', machineType: 'Hydraulic_Press', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
    ]);
    expect(m.heroLineId).toBe('LINE-0031');
  });

  it('counts risk bands + per-neighborhood criticalCount', () => {
    const m = plantToScene([
      line({ lineId: 'a', machineType: 'Grinder', riskBand: 'critical' }),
      line({ lineId: 'b', machineType: 'Grinder', riskBand: 'critical' }),
      line({ lineId: 'c', machineType: 'Grinder', riskBand: 'watch' }),
    ]);
    expect(m.counts).toMatchObject({ total: 3, critical: 2, watch: 1, healthy: 0, elevated: 0 });
    expect(m.neighborhoods[0].criticalCount).toBe(2);
  });

  it('is stable: same input → identical machine order + positions', () => {
    const lines = [
      line({ lineId: 'L3', machineType: 'CNC_Mill' }),
      line({ lineId: 'L1', machineType: 'CNC_Mill' }),
      line({ lineId: 'L2', machineType: 'Hydraulic_Press' }),
    ];
    const a = plantToScene(lines);
    const b = plantToScene([...lines]);
    expect(a.machines.map((x) => [x.lineId, x.x, x.z])).toEqual(b.machines.map((x) => [x.lineId, x.x, x.z]));
  });

  it('handles an empty plant without throwing', () => {
    const m = plantToScene([]);
    expect(m.neighborhoods).toEqual([]);
    expect(m.machines).toEqual([]);
    expect(m.heroLineId).toBeNull();
    expect(m.counts.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

Run (from `app/`): `npm test -- plant-to-scene`
Expected: FAIL — `Cannot find module '../plant-to-scene'`.

- [ ] **Step 3: Implement `plant-to-scene.ts`**

Implement `plantToScene(lines: LineStatus[]): PlantSceneModel`:
- A `const MACHINE_LABELS: Record<MachineType, string>` = `{ Hydraulic_Press:'Press Shop', Assembly_Robot:'Robot Cell', Welding_Cell:'Weld Bay', CNC_Mill:'CNC Row', Grinder:'Grind Line', Injection_Molder:'Molding' }`.
- Group lines by `machineType`; the neighborhoods present = the distinct types, in a FIXED canonical order (the key order of `MACHINE_LABELS`) so layout is deterministic. Lay out neighborhoods on the floor (e.g. a 3x2 district grid, each district centered at `(col*pitchX, row*pitchZ)` offset to center the floor at origin). Within a district, sort its lines by `lineId` and place them in a near-square grid (reuse the v1 `gridDims` helper idea: `cols=ceil(sqrt(n))`), machine spacing constant.
- Map `riskBand`→`colorHex` via `import { RISK_BAND_HEX } from '@/plantfloor/types'`; `emphasized = band==='critical' || band==='elevated'`.
- Hero: reuse the v1 deterministic `pickHero` (exposure desc → failureRiskScore desc → lineId asc), returns `lineId | null`.
- Counts: total + per-band; per-neighborhood `criticalCount`.
- Reuse the layout-constant approach + `gridDims` + `pickHero` from the retiring `lines-to-scene.ts` (copy the pure helpers over; do not import from the file being deleted).

- [ ] **Step 4: Run test to verify it PASSES**

Run (from `app/`): `npm test -- plant-to-scene`
Expected: PASS (all 8 cases). If a case fails, fix the implementation (never weaken a test); determinism (hero + stable layout) is a hard requirement.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/plant-to-scene.ts app/client/src/plantfloor3d/__tests__/plant-to-scene.test.ts
git commit -m "feat(plantfloor3d): pure plant-to-scene mapper (neighborhoods + hero), 8 unit tests

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 3: Procedural machine builders `machines.ts`

The 6 machine geometries + moving parts. Pure Three.js, no data deps. This is a large creative task; build one machine at a time, checking the build compiles after each.

**Files:**
- Create: `app/client/src/plantfloor3d/machines.ts`

- [ ] **Step 1: Module skeleton + dispatcher + shared helpers**

```typescript
// app/client/src/plantfloor3d/machines.ts
/**
 * Procedural machine builders for the Plant Floor 3D tab. Each of the 6
 * machineTypes assembles Three.js primitives into a recognizable machine with
 * named moving parts, plus an animate(t, phase, opts) hook. Pure Three — no
 * data or React deps. Adapted (r169 ESM) from the PCC foundry twin's builder
 * technique; NOT a verbatim port.
 */
import * as THREE from 'three';
import type { MachineType } from './scene.types';

export interface BuiltMachine {
  /** Root group to add to the scene at the machine's (x,z). */
  group: THREE.Group;
  /** The pickable body mesh (raycast target). userData.lineId set by the engine. */
  body: THREE.Mesh;
  /** Advance this machine's motion. phase = per-machine offset; emphasized = dramatic. */
  animate(t: number, phase: number, emphasized: boolean): void;
  /** Dispose all geometries/materials/particles this machine created. */
  dispose(): void;
}

export interface BuildMachineOpts {
  colorHex: number;      // risk color for the machine body accents
  emphasized: boolean;   // critical/elevated → dramatic motion + particles
  reducedMotion: boolean;
}

// Shared materials/geometries are created per-call but the engine passes the
// same opts for same (type,riskBand); the engine may cache BuiltMachine.group
// clones if profiling demands. Start simple: build per machine.

export function buildMachine(type: MachineType, opts: BuildMachineOpts): BuiltMachine {
  switch (type) {
    case 'Hydraulic_Press': return buildPress(opts);
    case 'Assembly_Robot': return buildRobot(opts);
    case 'Welding_Cell': return buildWeldCell(opts);
    case 'CNC_Mill': return buildCnc(opts);
    case 'Grinder': return buildGrinder(opts);
    case 'Injection_Molder': return buildMolder(opts);
  }
}
```

Add shared helpers: a `steelMat(color?)` returning a `MeshStandardMaterial({ color:0x8a94a6, roughness:0.5, metalness:0.6 })`, an `accentMat(hex)` for the risk-colored trim, and a disposer that tracks created geometries/materials in an array per machine.

- [ ] **Step 2: Build the 6 machines, one at a time**

Each builder returns `BuiltMachine`. Keep each recognizable by silhouette from across the floor and give it ONE clear moving part. Base footprint ~1.4 units; heights vary by type for silhouette variety. For each: build static parts into `group`, keep references to moving parts, push every geometry+material into a `disposables[]`, and implement `animate`:

- **`buildPress`** — tall H-frame (two columns + crown + bolster) + a **ram** box between the columns. `animate`: ram.y oscillates; emphasized = faster + harder (larger amplitude), healthy = slow shallow stroke. Body = the frame.
- **`buildRobot`** — base cylinder + shoulder + a 2-segment **arm** (group rotated). `animate`: arm sweeps (rotate base group on Y + elbow); emphasized faster. Body = base.
- **`buildWeldCell`** — cell frame (open box of struts) + a **torch** tip. Emphasized: add a small blue-white `PointLight` + a spark `Points` system that bursts; `animate` flickers the light + emits sparks. Healthy: torch idle, no light. Body = frame.
- **`buildCnc`** — enclosure box (with a colored window panel) + a **spindle** cylinder. `animate`: spindle spins on Y; emphasized adds a faint coolant-mist `Points` puff. Body = enclosure.
- **`buildGrinder`** — squat housing + a **wheel** (thin cylinder) on its side. `animate`: wheel spins fast; emphasized throws a spark `Points` stream. Body = housing.
- **`buildMolder`** — clamp unit (two platens) + barrel. `animate`: platens open/close cyclically; emphasized faster. Body = clamp base.

Particle systems (sparks/mist) are created ONLY when `opts.emphasized && !opts.reducedMotion`. Colors: body steel + `opts.colorHex` accents; emphasized machines get a stronger emissive on accents so bloom catches them. Under `reducedMotion`, `animate` is a no-op (static) — the engine still colors them.

After EACH builder, from `app/` run `npm run build:client` and confirm it compiles (fast feedback; a broken builder shouldn't block the others).

- [ ] **Step 3: Typecheck + build**

Run (from `app/`): `npm run typecheck 2>&1 | grep machines.ts` (expect clean) and `npm run build:client` (expect success, no `three/examples/jsm` warning).

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/machines.ts
git commit -m "feat(plantfloor3d): 6 procedural machine builders with moving parts + risk particles

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 4: Engine rewrite `scene.ts` (envelope + setPlant + motion + callout)

Rewrite the content-building half of the engine; keep the working scaffolding.

**Files:**
- Modify: `app/client/src/plantfloor3d/scene.ts`

- [ ] **Step 1: Keep scaffolding, swap the imports + handle shape**

Keep: all `three/addons/*` imports, renderer/camera/controls/CSS2D/composer(bloom+OutputPass) setup, `THREE.Clock`, `easeInOutCubic`/`clamp`/`stepCamTween`, `resize()`, reduced-motion animate branch, `dispose()` incl. `forceContextLoss()`, raycast NDC math. Add `import { buildMachine } from './machines'` and import the v2 types (`PlantSceneModel`, `SceneHandle`, `SelectPayload`, `SceneOptions`). Change the handle type to the v2 `SceneHandle` (`setPlant` not `setLines`). Remove the v1 instanced-box + beam state (`cabinetMesh`, `beamsMesh`, `instanceLineIds`, `instanceColor` logic).

- [ ] **Step 2: Build the persistent factory envelope once (in `createScene`, not `setPlant`)**

Injection point: the existing `scene.ts` already has `export function createScene(container, opts)` that builds renderer/camera/controls/composer, defines `animate()`, calls `animate()` once, and returns the handle. Build the envelope here — after the lights, before the `animate()` call — so it exists before ANY `setPlant`. It is added to the scene and NEVER disposed until `dispose()`. The first `setPlant` therefore runs with `state.plantGroup === null` (no previous plant to tear down — the dispose block is a no-op on first call). Do NOT build the envelope inside `setPlant`.

Build an `envelopeGroup` added to the scene and NEVER disposed until `dispose()`: a large floor plate (dark `MeshStandardMaterial`, `receiveShadow`), painted aisle stripes (thin bright planes between district positions), perimeter walls (4 tall thin boxes), a few roof trusses (thin boxes spanning), a faint window band (emissive strip), and optional overhead crane (a beam + trolley) with a slow `animate`. Keep references for disposal. This is the "real building" the v1 scene lacked.

- [ ] **Step 3: Implement `setPlant(model)` — per-plant content**

Maintain `state.plantGroup: THREE.Group | null` and `state.machines: { lineId, machineType, built: BuiltMachine, model: MachineModel }[]`, plus `state.lineIdToMachine: Map`, `state.heroLineId`, `state.calloutObj`. On `setPlant(model)`:
1. **Dispose the previous plant only** (NOT the envelope): for each `state.machines[].built.dispose()`; remove + dispose district CSS2D labels; remove the previous callout; remove `state.plantGroup` from scene and null it. (Concrete: switching PLANT-01→PLANT-02 tears down machines/labels/particles/callout, leaves floor/walls/roof/lighting/crane.)
2. Build a fresh `plantGroup`. For each `NeighborhoodModel`: add a subtle district floor tint + a CSS2D label (styled pill: uppercase, letter-spaced, dark translucent) at the district edge.
3. For each `MachineModel`: `const built = buildMachine(m.machineType, { colorHex: m.colorHex, emphasized: m.emphasized, reducedMotion })`; set `built.group.position.set(m.x, 0, m.z)`; `built.body.userData = { lineId, plantId, lineName, machineType, riskBand }`; push to pick targets + `state.machines` + `lineIdToMachine`. Give each machine a random `phase` for desynced motion.
4. Add `plantGroup` to scene. Cache `state.heroLineId = model.heroLineId`.
5. Do NOT auto-fly here (the view calls `focusLine(heroLineId)` after an establishing beat, same contract as v1).

- [ ] **Step 4: Animation loop — risk-driven motion + hero pulse + callout follow**

In `animate(t)`: keep `controls.update()`, `stepCamTween`, render branch (composer vs direct for reduced-motion), `labelRenderer.render`. Add: for each `state.machines`, call `built.animate(t, phase, emphasized)` unless `reducedMotion`. Pulse the hero machine (scale breathe) + its beacon. The floating callout `CSS2DObject` follows the focused machine (attached to its group, so it moves with it automatically).

- [ ] **Step 5: Raycast pick + hover (adapt v1)**

Raycast against the pick-target bodies (now per-machine meshes, not one instanced mesh): `raycaster.intersectObjects(pickTargets, false)`; on hit read `hit.object.userData` → build `SelectPayload` → `selectCb`. Drag-vs-click guard (>6px = drag) as v1. Hover: raise the hovered machine group slightly + cursor pointer; reset on leave (reuse the v1 `pointerleave` fix).

- [ ] **Step 6: Floating callout**

`showCalloutFor(lineId, telemetry?)`: create/move one CSS2DObject (the ONLY one) with a telemetry card (line name + vibration/temp/failure%/$ from the `MachineModel` we have; richer live values can come from the view later) + a small leader line, attached to that machine's group. On `focusLine` (hero or click) move it there. On `setPlant` remove it (re-created after the new fly-in). One at a time.

- [ ] **Step 7: `highlightRisk(band)`**

Implement `highlightRisk(band: RiskBand | 'all')`: store `state.activeRisk`; for each machine, if `band === 'all'` restore its normal material emissive/opacity, else if `machine.riskBand !== band` lower opacity/emissive (dim), else keep full. Cheap per-machine material tweak, no rebuild, no layout change. Guard after dispose.

- [ ] **Step 8: `focusLine` + `dispose` (adapt v1)**

`focusLine(lineId)`: look up the machine, tween camera to an orbit offset around its `(x,z)` (reuse v1 tween; reduced-motion snaps), set it as hero-pulse target, and show the callout on it. `dispose()`: cancel RAF, remove listeners (incl. `pointerleave`), dispose envelope + current plant machines + labels + callout + controls + renderer (`dispose()`+`forceContextLoss()`) + composer, remove both canvases. Guard all handle methods after dispose.

- [ ] **Step 9: Typecheck + build**

Run (from `app/`): `npm run typecheck 2>&1 | grep 'scene.ts'` (expect clean) and `npm run build:client` (success, no `three/examples/jsm`). At this point `PlantFloor3DView.tsx` still imports v1 stuff and will error in typecheck/build — that's expected; Task 5 fixes it. If the build fails ONLY due to `PlantFloor3DView`/`lines-to-scene` references, proceed to Task 5 (they're rewritten/deleted there). Confirm `scene.ts` + `machines.ts` themselves are clean.

- [ ] **Step 10: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/scene.ts
git commit -m "feat(plantfloor3d): engine rewrite — persistent envelope, setPlant, risk motion, callout

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 5: View rewrite `PlantFloor3DView.tsx` (required per-plant dropdown)

**Files:**
- Modify: `app/client/src/plantfloor3d/PlantFloor3DView.tsx`

- [ ] **Step 1: Rewrite data-binding + dropdown**

Adapt the existing view (keep the container/mount effect, ResizeObserver, reduced-motion detection, `dataMutated` subscribe-via-ref pattern, overlay chrome, `LineDetailPanel` mount, hero card, legend, search, orbit hint). Changes:
- State: `selectedPlant: string` (default `'PLANT-01'` — holds the global worst line so the hero lands on load), `lines: LineStatus[]`, `model: PlantSceneModel | null`, `selectedId`, `heroDismissed`, `riskFilter`, `loading`, `error`. Remove `allLines`/`plantFilter` (plant is now `selectedPlant`).
- **Plant dropdown = required, primary nav:** a prominent `<select>` of `PLANT-01..08` (hardcode the 8, or derive once); NO "All plants" option; `onChange` sets `selectedPlant`.
- **Per-plant fetch effect** (`[handle, selectedPlant]`): guard `if(!handle) return`; `fetchLines({ plant: selectedPlant })` → `setLines` → `const m = plantToScene(lines)` → `setModel(m)` → `handle.setPlant(m)`; then establishing beat `setTimeout(() => handle.focusLine(m.heroLineId), reduced?0:900)` (clear on cleanup). Reset `heroDismissed=false` on plant change so the new plant's hero card shows. Fly-in re-runs every plant switch (no `didFocusRef` guard now — we WANT re-fly on switch).
- **`dataMutated`** (empty-deps, ref pattern): refetch `fetchLines({ plant: <current via ref> })` → `setPlant` (recolor; no re-fly). Read `selectedPlant` via a ref to avoid stale closure.
- **Risk chips dim within plant (prescribed approach):** keep the chips (All / Critical / Elevated / Watch / Healthy). `plantToScene` ALWAYS maps every machine (never filters them out — the floor keeps its full population). Add ONE small engine method `handle.highlightRisk(band: RiskBand | 'all')`: when a band is active, the engine lowers the emissive/opacity of machines whose `riskBand !== band` (a cheap per-machine material tweak, no rebuild, no reshuffle) and restores full on `'all'`. The chip `onClick` sets `riskFilter` state and calls `handleRef.current?.highlightRisk(band)`. This is the single sanctioned way; do NOT filter machines out of the model or re-run `setPlant` for a chip. (This is the one intentional addition to the engine API beyond `setPlant/focusLine/onSelect/resize/dispose`.)
- Legend from `model.counts`; hero card from `lines.find(heroLineId)`; both CTAs unchanged.

- [ ] **Step 2: Typecheck + FULL build**

Context on the mid-rewrite state: after Task 4, `build:source` failed ONLY with errors in `PlantFloor3DView.tsx` (it still imported `setLines`/`linesToScene`/v1 types) — that was expected. This task rewrites the view, so NOW the build must be clean. If you still see errors in `scene.ts`, `machines.ts`, `plant-to-scene.ts`, or `scene.types.ts` themselves (not the view), stop and debug those first — they should already be clean from their tasks.

Run (from `app/`): `npm run typecheck 2>&1 | grep -E 'plantfloor3d/(scene|machines|plant-to-scene|PlantFloor3DView|scene.types)'` → expect clean for all v2 files. Then `npm run build:source` → **must be fully clean** (client + server), no `three/examples/jsm`, Three payload still code-split. (`lines-to-scene.ts` is deleted in Task 6; until then it may still sit on disk unused, which is harmless, but after THIS task nothing may still IMPORT it or `setLines`/`SceneModel`.)

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/PlantFloor3DView.tsx
git commit -m "feat(plantfloor3d): view rewrite — required per-plant dropdown, per-plant fetch + fly-in

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 6: Delete v1 mapper + verify nothing references it

**Files:**
- Delete: `app/client/src/plantfloor3d/lines-to-scene.ts`
- Delete: `app/client/src/plantfloor3d/__tests__/lines-to-scene.test.ts`

- [ ] **Step 1: Confirm no references remain**

Run (from `app/client/src`): `grep -rn "lines-to-scene\|linesToScene\|setLines\|InstanceModel\|BayModel\|SceneModel\b" plantfloor3d/ App.tsx` → expect NO matches (all migrated to `plant-to-scene`/`setPlant`/`PlantSceneModel`). Note: the grep intentionally does NOT match `SceneCounts`, `SelectPayload`, `SceneOptions`, or `SceneHandle` — those are KEPT in v2 (re-signed, not deleted), so references to them are correct and expected.

- [ ] **Step 2: Delete + verify**

```bash
cd ~/Desktop/Databricks/volta-industrial
git rm app/client/src/plantfloor3d/lines-to-scene.ts app/client/src/plantfloor3d/__tests__/lines-to-scene.test.ts
```
Run (from `app/`): `npm test` (v2 mapper tests pass, `passWithNoTests` covers rest) + `npm run build:source` (clean).

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git commit -m "chore(plantfloor3d): remove v1 lines-to-scene mapper (replaced by plant-to-scene)

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 7: Local devloop visual check (optional but recommended)

**Files:** none.

- [ ] **Step 1: Run the client dev server + eyeball it**

From `app/`, start the dev server (`npm run dev`), open `http://localhost:<port>/plant-floor-3d`, and sanity-check the scene renders detailed machines + envelope + neighborhoods (not boxes), the dropdown switches plants, critical machines animate. Fix obvious visual issues (scale, spacing, camera framing) before deploying. This is faster iteration than deploy. (Use the web-devloop-tester agent or Chrome DevTools MCP against localhost.) Commit any tuning.

---

## Task 8: Deploy + in-browser verification (deployed origin)

**Files:** none.

- [ ] **Step 1: Deploy**

```bash
cd ~/Desktop/Databricks/volta-industrial/app
export DATABRICKS_CONFIG_PROFILE=fe-sandbox-predictive-maintainers
./scripts/deploy.sh
```
Backgrounded, several min. Watch for Bug-D (SP Lakebase role drop → 503); `deploy.sh` auto-re-grants. If it warns "SP role didn't appear": run `app/scripts/lakebase_grant_app_credential.sh --app-name volta-plant-floor --project-id volta --db-name volta --branch-id development` then `databricks apps stop volta-plant-floor -p fe-sandbox-predictive-maintainers` + `start`.

- [ ] **Step 2: Verify in Chrome DevTools MCP (agent-driven; SSO human-in-loop)**

Load MCP tools via ToolSearch. Kill any orphaned `chrome-devtools-mcp/chrome-profile` PID + clear Singleton locks first. Navigate to `https://volta-plant-floor-7474647707959925.aws.databricksapps.com/plant-floor-3d`; if a login card shows, pause and ask the user to complete SSO in the MCP Chrome. Then screenshot + verify:
  1. A plant's floor renders **detailed machines + factory envelope + neighborhood labels + painted aisles** (NOT boxes, NOT blank, NOT login).
  2. Establishing shot → fly-in to the plant's worst line + floating telemetry callout.
  3. Critical machines throw sparks/arc + beacon; healthy idle quietly.
  4. Click a machine → slide-over shows live Lakebase fields; both CTAs work (Ask assistant seeds hero Q into dock; Open in Operations → `/operations?line=`).
  5. Switch plants in the dropdown a few times → floor re-renders each time, fly-in + callout re-run.
  6. Approve a work order in chat → that machine recolors/calms on the `dataMutated` refetch.
  7. Cycle all 8 plants → `list_console_messages` shows no WebGL "too many contexts" warning, no failed `/api/*`, no `three/examples/jsm` (no-leak check).
  A boxes/blank/login/console-error result is NOT success. Screenshot each as evidence.

- [ ] **Step 3: Confirm legacy Operations still works**

Navigate `/operations`; confirm its (untouched) box-grid + table + drawer still render (proves the v2 rewrite didn't disturb the legacy import).

- [ ] **Step 4: Report + reminder**

Report verified state with screenshots + the rollback point. Tip before any push: these changes haven't been reviewed with Isaac Review yet; the user can run /review.

---

## Notes for the implementer
- **DRY:** reuse `RISK_BAND_HEX`, `fetchLines`/`fetchLine`, `RiskBadge`, `dockController`, `dataMutated`, and the v1 engine scaffolding (camera tween, dispose, reduced-motion, raycast math). Copy the pure helpers (`gridDims`, `pickHero`) out of the retiring `lines-to-scene.ts` into `plant-to-scene.ts` rather than importing across the delete.
- **YAGNI:** no GLTF, no inter-neighborhood conveyors, no in-scene sparklines, no rendering all 8 plants. The engine API is exactly `setPlant/focusLine/onSelect/highlightRisk/resize/dispose` — do not grow it beyond these six.
- **Perf:** one plant (~150 machines), particles only on emphasized machines, allocation-free loop, dispose the previous plant fully on switch (envelope excepted). Target 60fps.
- **Reduced motion:** `animate` no-ops per machine, no particles, camera snaps; static risk coloring still applies.
- **Determinism:** hero + machine layout stable across refetches (Task 2 tests enforce) so the `dataMutated` recolor doesn't reshuffle the floor.
- **Do not regress the v1 pitfalls:** `PCFSoftShadowMap`, `three/addons/*`, `outputColorSpace`/`OutputPass`, non-zero container height, CSS2D overlay, full dispose + `forceContextLoss()`, legacy `plantfloor/` untouched.
