# Plant Floor 3D Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen "Plant Floor 3D" tab (`/plant-floor-3d`) to the Volta app: an orbitable 3D factory of 8 plant bays rendering all ~1,200 live Lakebase lines as InstancedMesh cabinets colored by risk, that flies in to the top-exposure critical line on load, opens a live per-line slide-over on click, and bridges into the existing Assist (chat) + Act (Operations) loop — closing live when the agent writes a work order.

**Architecture:** A framework-agnostic vanilla-Three.js engine (`scene.ts`) exposes an imperative API (`init/setLines/focusLine/onSelect/dispose/resize`) that a React page (`PlantFloor3DView.tsx`) drives. A pure mapping module (`lines-to-scene.ts`) turns the app's `LineStatus[]` into the scene's bay/instance model and is unit-tested in isolation. A slide-over (`LineDetailPanel.tsx`) fetches live `/api/lines/:id` and renders the two CTAs. The scene reuses the *visual language* of the PCC foundry twin (dark room, colored bays, floating CSS2D labels, UnrealBloom glow on critical machines, eased camera tween) but is rebuilt on Volta's already-bundled **`three@0.169` ESM** — importing addons from the official `three/addons/*` alias — so there is NO r128 vendoring and no `three/examples/jsm/*` build warnings. The legacy box-grid at `client/src/plantfloor/` is left untouched (Operations still lazy-imports it).

**Tech Stack:** React 18 + react-router 7, TypeScript (strict), Vite 6 / esbuild, `three@0.169.0` (ESM, already a dependency) + `@types/three@0.169`, `three/addons/*` (OrbitControls, CSS2DRenderer, EffectComposer, RenderPass, UnrealBloomPass, OutputPass), Vitest 2 (node env, `@` alias → `client/src`), Tailwind 4, lucide-react icons, `@databricks/appkit-ui` primitives. Databricks App (AppKit Node/Express server + Vite client), Lakebase Postgres backend.

---

## Context the implementer needs (read before Task 1)

**This is a real Databricks App that is LIVE and graded — do not break the existing build.** Verified integration facts (all confirmed against the current tree this session):

- **Repo/branch:** `~/Desktop/Databricks/volta-industrial`, branch `build/volta-app`, app under `app/`. Rollback point: HEAD `56a8b36`, pushed to `origin/build/volta-app`, working tree clean.
- **All client code lives under `app/client/src/`.** The `@` path alias → `app/client/src` (both `client/vite.config.ts` and `vitest.config.ts`). Run npm/vitest/build commands from **`app/`** (that's where `package.json` is — there is NO `app/client/package.json`).
- **`three@0.169.0` is already a dependency** and `@types/three@0.169` a devDependency — nothing to install. The installed package ships `examples/jsm/{controls/OrbitControls,renderers/CSS2DRenderer,postprocessing/EffectComposer,postprocessing/RenderPass,postprocessing/UnrealBloomPass,postprocessing/OutputPass}.js` AND exposes the `"./addons/*": "./examples/jsm/*"` export alias, with matching `.d.ts` typings. **Import addons as `three/addons/…`** (e.g. `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'`). Do NOT import `three/examples/jsm/*` (the broken box-grid used that path and it warned at build).
- **Data contract** (`app/client/src/shared/types.ts`): `LineStatus` has `lineId, plantId, lineName, machineType, criticality, plantLat, plantLng, vibrationRms, temperatureC, utilizationPct, failureRiskScore, openWoCount, hasOpenCorrective, candidatePartId, partLocal, partUnitCostUsd, partLeadTimeDays, riskSignalScore, downtimeExposureUsd, riskBand`. `riskBand: 'critical' | 'elevated' | 'watch' | 'healthy'`.
- **Live data shape (queried from Lakebase this session):** exactly **8 plants** `PLANT-01`…`PLANT-08`, **1,200 lines total**, 6 machine types (`Hydraulic_Press, Assembly_Robot, Welding_Cell, CNC_Mill, Grinder, Injection_Molder`). Risk split: 1045 healthy / 90 critical / 61 watch / 4 elevated. Per-plant line counts vary 130–167. **Top downtime exposure is a 5-way tie at $41,800** (`LINE-0317`, `LINE-0278`, `LINE-0031`, `LINE-0122`, `LINE-0369`) — so "the single hero" MUST use a deterministic tiebreak (highest exposure, then highest `failureRiskScore`, then `lineId` ascending) or the fly-in target is non-deterministic.
- **`GET /api/lines` has NO server-side LIMIT** (`app/server/db/queries/maintenance.ts` `listLines`) — unfiltered, it returns all 1,200 rows. The 3D view fetches unfiltered (`fetchLines({})`), unlike Operations which passes `riskBand=critical`.
- **Fetch helpers (`app/client/src/lib/lines.ts`):** `fetchLines(filters) → LineStatus[]`, `fetchLine(id) → LineDetail`, `fetchLinesSummary() → LinesSummary[]`. **REUSE these — no new backend.** Note: `fetchLine` returns `LineDetail`, whose fields are **snake_case** (`line_id`, `plant_id`, `vibration_rms`, `temperature_c`, `failure_risk_score`, `downtime_exposure_usd`, `open_wo_count`, `part_local`, `part_lead_time_days`, `candidate_part_id`, `work_orders`, `risk_band`, …), unlike `LineStatus` which is camelCase.
- **Risk→color constant already exists and matches the whole app:** `app/client/src/plantfloor/types.ts` exports `RISK_BAND_HEX: Record<RiskBand, number>` = `{ critical: 0xE5484D, elevated: 0xFFB020, watch: 0xFFB020, healthy: 0x3C6997 }`. **Import and reuse it** (`import { RISK_BAND_HEX } from '@/plantfloor/types'`) — do not hardcode new colors. This file is in the legacy folder but importing a pure constant from it is safe (does not touch the box-grid component).
- **Chat CTA:** `import { dockController } from '@/chat/dockController'`; call `dockController.openAndSend(promptString)` to open the floating chat dock and send the hero question.
- **Operations deep-link CTA:** navigate to `/operations?line=LINE-XXXX`. `OperationsView` already reads `searchParams.get('line')` into `selectedId` and opens `LineDrawer` — this path is already wired and fixed; the 3D panel just needs to `navigate('/operations?line=' + lineId)`.
- **Live-update bus:** `import { dataMutated } from '@/lib/events'`. `dataMutated.subscribe(fn)` returns an unsubscribe fn; the chat turn-end emits it. The page subscribes → refetch `/api/lines` → `scene.setLines(...)`.
- **Router (`app/client/src/App.tsx`):** `createBrowserRouter`, children array around L70–76 (`/`, `/c/:id`, `/operations`, `/analytics`, `/dashboard`, `/platform`). Lazy-load the new route with `React.lazy` + `<Suspense>`.
- **Sidebar (`app/client/src/shell/AppSidebar.tsx`):** `navItems` array at L21–26 (`{ to, label, icon, end }`, icons from `lucide-react`). Add the new item there.
- **App header is `h-14`** (56px) — the 3D container height is `calc(100vh - 56px)` = `h-[calc(100vh-3.5rem)]`.
- **NO existing client unit tests** (only `app/tests/smoke.spec.ts`, a Playwright e2e excluded from vitest). This plan adds the first `*.test.ts`. Vitest config: `environment: 'node'`, `globals: true`, `passWithNoTests: true`, excludes `**/*.spec.ts`. So name unit tests `*.test.ts` (NOT `.spec.ts`) and keep them pure (no DOM/WebGL) so they run under the node environment.

**Known pitfalls (from the broken box-grid — do not repeat):**
1. `THREE.PCFShadowShadowMap` is a typo → use `THREE.PCFSoftShadowMap`.
2. WebGL "zero size" framebuffer if the container has no height before `renderer.setSize`. Give the container a fixed height and read `clientWidth/clientHeight` after mount (with a sane fallback).
3. `three/examples/jsm/*` imports warn at build → import from `three/addons/*`.
4. CSS2DRenderer needs a sibling DOM overlay layer above the WebGL canvas with `position:absolute; top:0; left:0; pointerEvents:none`.
5. r150+ removed `renderer.outputEncoding`/`sRGBEncoding` (the PCC scene used them). In `three@0.169` use `renderer.outputColorSpace = THREE.SRGBColorSpace` (usually the default) — do NOT copy `outputEncoding`/`sRGBEncoding` from PCC scene.js.
6. Leave `app/client/src/plantfloor/` (legacy box-grid) UNTOUCHED except reading its exported constants.

**Style constraints:** No em dashes in prose/UI copy (use commas/colons). Serverless only. Must look like a premium Fortune-500 product (not AI-generated). Dark theme; reuse app tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `var(--brand-*)`).

**Reference look:** `~/Desktop/Databricks/pcc-3d-scene.png` — dark charcoal room, colored floor-zone strips per line with floating pill labels, cabinet machines, a health-status legend bottom-left, orbit hint bottom. Translate to 8 plant bays.

---

## File Structure

New folder `app/client/src/plantfloor3d/` (separate from legacy `plantfloor/`):

| File | Responsibility |
|------|----------------|
| `lines-to-scene.ts` | **Pure, no Three import.** `LineStatus[]` → `{ bays: BayModel[], instances: InstanceModel[], heroLineId, counts }`. Group by `plantId` into 8 bays; lay out each bay's lines in a grid; map `riskBand`→color+priority; pick hero (deterministic tiebreak). Unit-tested. |
| `scene.types.ts` | Shared TS types the mapping + engine + view agree on (`InstanceModel`, `BayModel`, `SceneModel`, `SceneHandle`, `SelectPayload`). No runtime deps. |
| `scene.ts` | **Imperative Three.js engine.** `createScene(container, opts) → SceneHandle` with `setLines(model)`, `focusLine(lineId)`, `onSelect(cb)`, `resize()`, `dispose()`. InstancedMesh cabinets, per-bay floor tiles + CSS2D bay labels, UnrealBloom, hero beam + pulse, eased camera tween, raycast→instanceId→lineId. Imports `three` + `three/addons/*`. |
| `LineDetailPanel.tsx` | Slide-over. Given `lineId`, `fetchLine(id)` → live Lakebase card (vibration, temp, failure %, $ exposure, open WOs, part-local, lead time) + two CTAs (Ask assistant / Open in Operations). |
| `PlantFloor3DView.tsx` | Route/page. Fetch `/api/lines` (+ summary), mount scene in a sized container, render overlay UI (legend, per-plant + per-risk filters, search-to-focus, on-load hero risk card, the panel). Subscribe to `dataMutated` → refetch → `setLines`. |
| `__tests__/lines-to-scene.test.ts` | Unit tests for the pure mapping. |

Modified: `app/client/src/App.tsx` (lazy route), `app/client/src/shell/AppSidebar.tsx` (nav item).

---

## Task 1: Scene model types + pure mapping (`lines-to-scene`)

This is the testable core. No Three.js, no React — just data → data. Build it first and lock it with tests.

**Files:**
- Create: `app/client/src/plantfloor3d/scene.types.ts`
- Create: `app/client/src/plantfloor3d/lines-to-scene.ts`
- Test: `app/client/src/plantfloor3d/__tests__/lines-to-scene.test.ts`

- [ ] **Step 1: Write `scene.types.ts`** (types only, no logic — safe to write in full up front)

```typescript
// app/client/src/plantfloor3d/scene.types.ts
/**
 * Shared shapes for the Plant Floor 3D tab: the pure mapping
 * (lines-to-scene.ts) produces a SceneModel; the vanilla-Three engine
 * (scene.ts) consumes it; the React view (PlantFloor3DView.tsx) drives both.
 * Kept dependency-free so the mapping stays unit-testable in the node env.
 */
import type { RiskBand } from '@/shared/types';

/** One production line rendered as a single cabinet instance. */
export interface InstanceModel {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: string;
  riskBand: RiskBand;
  failureRiskScore: number;
  downtimeExposureUsd: number;
  /** Grid slot within the bay (col, row), 0-indexed. */
  col: number;
  row: number;
  /** World position, precomputed so the engine just reads x/z (y is fixed). */
  x: number;
  z: number;
  /** 0xRRGGBB from RISK_BAND_HEX — the cabinet's color. */
  colorHex: number;
  /** True for critical/elevated (pop + emissive); false for watch/healthy (dim). */
  emphasized: boolean;
}

/** One plant = one floor tile + label, holding a grid of line cabinets. */
export interface BayModel {
  plantId: string;
  label: string;
  /** Bay center in world space + tile half-extents (for the floor plane). */
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  lineCount: number;
  criticalCount: number;
}

export interface SceneCounts {
  total: number;
  critical: number;
  elevated: number;
  watch: number;
  healthy: number;
}

export interface SceneModel {
  bays: BayModel[];
  instances: InstanceModel[];
  /** The single line the on-load camera flies to. Null only if zero lines. */
  heroLineId: string | null;
  counts: SceneCounts;
}

/** Fired when the user clicks a cabinet. */
export interface SelectPayload {
  lineId: string;
  plantId: string;
  lineName: string;
  machineType: string;
  riskBand: RiskBand;
}

/** Imperative handle the React view holds onto. */
export interface SceneHandle {
  setLines(model: SceneModel): void;
  focusLine(lineId: string): void;
  onSelect(cb: (payload: SelectPayload) => void): void;
  resize(): void;
  dispose(): void;
}

export interface SceneOptions {
  /** Disable bloom/animation for reduced-motion or perf fallback. */
  reducedMotion?: boolean;
}
```

- [ ] **Step 2: Write the failing test** for the pure mapping

```typescript
// app/client/src/plantfloor3d/__tests__/lines-to-scene.test.ts
import { describe, it, expect } from 'vitest';
import { linesToScene, RISK_PRIORITY } from '../lines-to-scene';
import type { LineStatus, RiskBand } from '@/shared/types';

// Minimal LineStatus factory — only the fields the mapping reads matter.
function line(over: Partial<LineStatus> & { lineId: string; plantId: string }): LineStatus {
  return {
    lineName: over.lineId,
    machineType: 'CNC_Mill',
    criticality: 'high',
    plantLat: 0,
    plantLng: 0,
    vibrationRms: 0,
    temperatureC: 0,
    utilizationPct: 0,
    failureRiskScore: 0,
    openWoCount: 0,
    hasOpenCorrective: false,
    candidatePartId: null,
    partLocal: false,
    partUnitCostUsd: null,
    partLeadTimeDays: null,
    riskSignalScore: null,
    downtimeExposureUsd: 0,
    riskBand: 'healthy' as RiskBand,
    ...over,
  };
}

describe('linesToScene', () => {
  it('groups lines into one bay per distinct plantId', () => {
    const lines = [
      line({ lineId: 'L1', plantId: 'PLANT-01' }),
      line({ lineId: 'L2', plantId: 'PLANT-01' }),
      line({ lineId: 'L3', plantId: 'PLANT-02' }),
    ];
    const model = linesToScene(lines);
    expect(model.bays).toHaveLength(2);
    expect(model.bays.map((b) => b.plantId).sort()).toEqual(['PLANT-01', 'PLANT-02']);
    expect(model.bays.find((b) => b.plantId === 'PLANT-01')!.lineCount).toBe(2);
  });

  it('produces exactly one instance per input line', () => {
    const lines = Array.from({ length: 25 }, (_, i) =>
      line({ lineId: `L${i}`, plantId: `PLANT-0${(i % 8) + 1}` }),
    );
    const model = linesToScene(lines);
    expect(model.instances).toHaveLength(25);
  });

  it('maps riskBand to the app RISK_BAND_HEX color', () => {
    const model = linesToScene([
      line({ lineId: 'C', plantId: 'PLANT-01', riskBand: 'critical' }),
      line({ lineId: 'H', plantId: 'PLANT-01', riskBand: 'healthy' }),
    ]);
    const crit = model.instances.find((i) => i.lineId === 'C')!;
    const heal = model.instances.find((i) => i.lineId === 'H')!;
    expect(crit.colorHex).toBe(0xe5484d);
    expect(heal.colorHex).toBe(0x3c6997);
    expect(crit.emphasized).toBe(true);
    expect(heal.emphasized).toBe(false);
  });

  it('picks hero = max downtimeExposureUsd', () => {
    const model = linesToScene([
      line({ lineId: 'A', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 100 }),
      line({ lineId: 'B', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 500 }),
      line({ lineId: 'C', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 300 }),
    ]);
    expect(model.heroLineId).toBe('B');
  });

  it('breaks an exposure tie by failureRiskScore desc, then lineId asc (deterministic)', () => {
    // Mirrors the real data: 5-way tie at 41800. Must be stable.
    const model = linesToScene([
      line({ lineId: 'LINE-0317', plantId: 'PLANT-02', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.8 }),
      line({ lineId: 'LINE-0031', plantId: 'PLANT-01', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
      line({ lineId: 'LINE-0122', plantId: 'PLANT-03', riskBand: 'critical', downtimeExposureUsd: 41800, failureRiskScore: 0.9 }),
    ]);
    // Highest failureRiskScore is a tie (0.9) between LINE-0031 and LINE-0122;
    // lineId asc breaks it → LINE-0031.
    expect(model.heroLineId).toBe('LINE-0031');
  });

  it('counts risk bands correctly', () => {
    const model = linesToScene([
      line({ lineId: 'a', plantId: 'PLANT-01', riskBand: 'critical' }),
      line({ lineId: 'b', plantId: 'PLANT-01', riskBand: 'critical' }),
      line({ lineId: 'c', plantId: 'PLANT-01', riskBand: 'watch' }),
      line({ lineId: 'd', plantId: 'PLANT-01', riskBand: 'healthy' }),
    ]);
    expect(model.counts).toMatchObject({ total: 4, critical: 2, watch: 1, healthy: 1, elevated: 0 });
    expect(model.bays[0].criticalCount).toBe(2);
  });

  it('is stable: same input → identical instance order and positions', () => {
    const lines = [
      line({ lineId: 'L3', plantId: 'PLANT-01' }),
      line({ lineId: 'L1', plantId: 'PLANT-01' }),
      line({ lineId: 'L2', plantId: 'PLANT-01' }),
    ];
    const a = linesToScene(lines);
    const b = linesToScene([...lines]);
    expect(a.instances.map((i) => [i.lineId, i.x, i.z])).toEqual(
      b.instances.map((i) => [i.lineId, i.x, i.z]),
    );
  });

  it('handles empty input without throwing', () => {
    const model = linesToScene([]);
    expect(model.bays).toEqual([]);
    expect(model.instances).toEqual([]);
    expect(model.heroLineId).toBeNull();
    expect(model.counts.total).toBe(0);
  });

  it('exposes a RISK_PRIORITY ordering with critical highest', () => {
    expect(RISK_PRIORITY.critical).toBeGreaterThan(RISK_PRIORITY.elevated);
    expect(RISK_PRIORITY.elevated).toBeGreaterThan(RISK_PRIORITY.watch);
    expect(RISK_PRIORITY.watch).toBeGreaterThan(RISK_PRIORITY.healthy);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `app/`): `npm test -- lines-to-scene`
Expected: FAIL — `Cannot find module '../lines-to-scene'` (file not created yet).

- [ ] **Step 4: Implement `lines-to-scene.ts`** to make it pass

```typescript
// app/client/src/plantfloor3d/lines-to-scene.ts
/**
 * PURE mapping: the app's LineStatus[] (GET /api/lines, all ~1,200 rows) →
 * a SceneModel the vanilla-Three engine renders. No Three.js, no React, no
 * fetch — deterministic and unit-testable in the node env.
 *
 * Layout: one bay per plant, bays arranged left→right in a shallow arc grid.
 * Within a bay, lines fill a near-square grid of same-size cabinet slots in
 * stable lineId order, so a given line always lands in the same spot (the
 * camera can fly to it and re-renders don't reshuffle the floor).
 */
import type { LineStatus, RiskBand } from '@/shared/types';
import { RISK_BAND_HEX } from '@/plantfloor/types';
import type { SceneModel, BayModel, InstanceModel, SceneCounts } from './scene.types';

/** Higher = more visually urgent. Drives emphasis + (future) sort. */
export const RISK_PRIORITY: Record<RiskBand, number> = {
  critical: 3,
  elevated: 2,
  watch: 1,
  healthy: 0,
};

// --- Layout constants (world units). Tuned so 8 bays of ~150 cabinets read
// as a factory floor from the establishing shot yet stay legible on zoom. ---
const CELL = 2.2;          // spacing between cabinet centers within a bay
const BAY_GAP = 6;         // gap between adjacent bays
const BAYS_PER_ROW = 4;    // 8 plants → 4 x 2 arrangement

function riskColor(band: RiskBand): number {
  return RISK_BAND_HEX[band] ?? RISK_BAND_HEX.healthy;
}

/** Near-square grid dimensions for n items (cols >= rows). */
function gridDims(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function linesToScene(lines: LineStatus[]): SceneModel {
  // 1. Group by plant, in ascending plantId order (stable, matches PLANT-01..08).
  const byPlant = new Map<string, LineStatus[]>();
  for (const l of lines) {
    const arr = byPlant.get(l.plantId);
    if (arr) arr.push(l);
    else byPlant.set(l.plantId, [l]);
  }
  const plantIds = [...byPlant.keys()].sort();

  const bays: BayModel[] = [];
  const instances: InstanceModel[] = [];
  const counts: SceneCounts = { total: 0, critical: 0, elevated: 0, watch: 0, healthy: 0 };

  // Precompute bay footprints so we can center the whole floor around origin.
  const bayGrids = plantIds.map((pid) => gridDims(byPlant.get(pid)!.length));
  const bayW = bayGrids.map((g) => Math.max(1, g.cols) * CELL);
  const bayD = bayGrids.map((g) => Math.max(1, g.rows) * CELL);

  // Uniform bay pitch = widest bay + gap (keeps the arc regular + readable).
  const maxBayW = Math.max(CELL, ...bayW);
  const maxBayD = Math.max(CELL, ...bayD);
  const pitchX = maxBayW + BAY_GAP;
  const pitchZ = maxBayD + BAY_GAP;

  const rowsOfBays = Math.ceil(plantIds.length / BAYS_PER_ROW);
  const floorOffsetX = ((Math.min(plantIds.length, BAYS_PER_ROW) - 1) * pitchX) / 2;
  const floorOffsetZ = ((rowsOfBays - 1) * pitchZ) / 2;

  plantIds.forEach((pid, bi) => {
    const bayLines = byPlant.get(pid)!.slice().sort((a, b) => a.lineId.localeCompare(b.lineId));
    const { cols, rows } = bayGrids[bi];

    const bayRow = Math.floor(bi / BAYS_PER_ROW);
    const bayColIdx = bi % BAYS_PER_ROW;
    const centerX = bayColIdx * pitchX - floorOffsetX;
    const centerZ = bayRow * pitchZ - floorOffsetZ;

    // Grid origin = top-left cabinet of the bay, centered on the bay center.
    const originX = centerX - ((cols - 1) * CELL) / 2;
    const originZ = centerZ - ((rows - 1) * CELL) / 2;

    let criticalCount = 0;
    bayLines.forEach((l, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const band = l.riskBand;
      const emphasized = band === 'critical' || band === 'elevated';
      if (band === 'critical') criticalCount++;
      counts[band] = (counts[band] ?? 0) + 1;
      counts.total++;
      instances.push({
        lineId: l.lineId,
        plantId: l.plantId,
        lineName: l.lineName,
        machineType: l.machineType,
        riskBand: band,
        failureRiskScore: l.failureRiskScore,
        downtimeExposureUsd: l.downtimeExposureUsd,
        col,
        row,
        x: originX + col * CELL,
        z: originZ + row * CELL,
        colorHex: riskColor(band),
        emphasized,
      });
    });

    bays.push({
      plantId: pid,
      label: pid,
      centerX,
      centerZ,
      halfW: (Math.max(1, cols) * CELL) / 2 + 0.6,
      halfD: (Math.max(1, rows) * CELL) / 2 + 0.6,
      lineCount: bayLines.length,
      criticalCount,
    });
  });

  return { bays, instances, heroLineId: pickHero(lines), counts };
}

/**
 * The single line the camera flies to on load: highest downtime exposure,
 * tie-broken by failureRiskScore desc then lineId asc so it is deterministic
 * (the real data has a 5-way exposure tie at $41,800).
 */
function pickHero(lines: LineStatus[]): string | null {
  let best: LineStatus | null = null;
  for (const l of lines) {
    if (best === null) {
      best = l;
      continue;
    }
    if (l.downtimeExposureUsd > best.downtimeExposureUsd) best = l;
    else if (l.downtimeExposureUsd === best.downtimeExposureUsd) {
      if (l.failureRiskScore > best.failureRiskScore) best = l;
      else if (l.failureRiskScore === best.failureRiskScore && l.lineId < best.lineId) best = l;
    }
  }
  return best ? best.lineId : null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `app/`): `npm test -- lines-to-scene`
Expected: PASS (all cases). If a position-stability or hero case fails, fix the mapping (not the test) — determinism here is a hard requirement.

- [ ] **Step 6: Typecheck**

Run (from `app/`): `npm run typecheck`
Expected: no new errors from `plantfloor3d/`.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/scene.types.ts app/client/src/plantfloor3d/lines-to-scene.ts app/client/src/plantfloor3d/__tests__/lines-to-scene.test.ts
git commit -m "feat(plantfloor3d): pure LineStatus[]->SceneModel mapping + types (tested)

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 2: The Three.js engine (`scene.ts`)

The imperative vanilla-Three engine. No React. Renders the SceneModel: per-bay floor tiles + CSS2D labels, all lines as InstancedMesh cabinets colored by risk, UnrealBloom, a beam + pulse on critical, eased camera fly-to, and raycast picking that maps `instanceId` → `lineId`. Cannot be meaningfully unit-tested (needs WebGL); verified via build + in-browser in later tasks. Write it in focused, reviewable steps.

**Files:**
- Create: `app/client/src/plantfloor3d/scene.ts`

- [ ] **Step 1: Skeleton + imports + renderer/camera/controls/bloom setup**

Create `scene.ts` with the module doc + `createScene(container, opts): SceneHandle`. Imports (note the `three/addons/*` alias — NOT `three/examples/jsm/*`):

```typescript
// app/client/src/plantfloor3d/scene.ts
/**
 * Plant Floor 3D engine — vanilla Three.js, framework-agnostic.
 *
 * Reuses the VISUAL LANGUAGE of the PCC foundry twin (dark room, colored bays,
 * floating CSS2D labels, UnrealBloom glow on the machines that matter, eased
 * camera fly-to) but is rebuilt on the app's bundled three@0.169 ESM. All
 * ~1,200 lines render as a single InstancedMesh (one instance per line), so
 * the eye still snaps to the ~90 critical among the crowd at 60fps.
 *
 * Public surface (SceneHandle): setLines / focusLine / onSelect / resize /
 * dispose. The React view owns data + overlay; this file owns pixels.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { SceneModel, SceneHandle, SelectPayload, SceneOptions, InstanceModel } from './scene.types';

export function createScene(container: HTMLElement, opts: SceneOptions = {}): SceneHandle {
  // ... (subsequent steps fill this in)
}
```

Inside, set up (mirrors PCC scene.js but with r169 API — read `container.clientWidth || <fallback>` for the zero-size pitfall, and use `outputColorSpace`, NOT `outputEncoding`):

```typescript
  const sizeOf = () => ({
    w: container.clientWidth || 1200,
    h: container.clientHeight || 800,
  });
  let { w, h } = sizeOf();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1c);        // app deep-navy base
  scene.fog = new THREE.FogExp2(0x0a0f1c, 0.012);

  const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 500);
  const CAM_HOME = { pos: [0, 60, 90] as const, target: [0, 0, 0] as const };
  camera.position.set(...CAM_HOME.pos);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;    // NOT PCFShadowShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace;    // r169 replacement for outputEncoding
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // CSS2D overlay layer (bay labels + hero callout). Sibling of the canvas,
  // absolutely positioned over it, click-through.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.05;     // don't drop under the floor
  controls.minDistance = 12;
  controls.maxDistance = 220;
  controls.target.set(...CAM_HOME.target);

  // Lights (cool hemisphere + warm key, matches the reference render mood).
  scene.add(new THREE.HemisphereLight(0xbfd2e6, 0x0c1420, 0.55));
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(40, 80, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  // Bloom composer: critical cabinets (bright emissive) glow, dim ones don't.
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.5, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());  // r169 replacement for GammaCorrectionShader tail
```

Return a stub `SceneHandle` for now (`setLines/focusLine/onSelect/resize/dispose` as no-ops) so the file compiles, and start the animation loop via `requestAnimationFrame`.

**Reduced-motion branch (required — house accessibility rule):** honor `opts.reducedMotion`. The loop always calls `controls.update()` + `labelRenderer.render(scene, camera)`, but branches the WebGL render + per-frame motion:
```typescript
const animate = () => {
  rafId = requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  controls.update();
  if (camTween.active) stepCamTween(t);        // camera fly-to still runs (it's a discrete transition, not ambient motion)
  if (!opts.reducedMotion) stepPulse(t);        // skip the ambient critical pulse/beam shimmer when reduced-motion
  if (opts.reducedMotion) renderer.render(scene, camera);  // skip the bloom composer (cheaper + calmer)
  else composer.render();
  labelRenderer.render(scene, camera);
};
```
So under reduced-motion: no bloom, no ambient pulsing; the camera fly-to on load becomes an instant snap (see `focusLine`, Step 4). The view detects the preference and passes it in (Task 4, Step 1).

- [ ] **Step 2: Build the instanced cabinets + bay floors in `setLines`**

Implement `setLines(model)`: dispose any previous meshes, then build:
- **Floor tiles per bay:** a `PlaneGeometry` (or thin `BoxGeometry`) per `BayModel` at `y ≈ -0.05`, dark with a subtle emissive edge; add a `CSS2DObject` pill label (`bay.label`, styled like the reference: uppercase, letter-spaced, dark translucent bg) at the bay's front edge.
- **Cabinets:** ONE `THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.6, 1.2), new THREE.MeshStandardMaterial(...), model.instances.length)`. For each instance set matrix (position `x, 0.8, z`; emphasized ones slightly taller/scaled) via `dummy.position/scale`, `dummy.updateMatrix()`, `mesh.setMatrixAt(i, dummy.matrix)`; set color via `mesh.setColorAt(i, tmpColor.setHex(inst.colorHex))`. Store a parallel `instanceLineIds: string[]` (index → lineId) for pick mapping, and a `lineIdToIndex: Map<string, number>` for `focusLine`. Set `mesh.instanceMatrix.needsUpdate = true` and `mesh.instanceColor!.needsUpdate = true`. Enable `castShadow/receiveShadow`.
- Emphasized cabinets: raising `material` emissive per-instance is not possible on a shared material, so encode emphasis in the instance color's brightness AND render the beams below. Healthy cabinets stay dim (their color already is `#3C6997`).
- **Vertical beams are MANDATORY, not optional** — spec §4 requires "critical #E5484D + vertical beam". Build a **second InstancedMesh of vertical beams** (tall thin cylinder/box, additive `MeshBasicMaterial` with `toneMapped:false` so UnrealBloom picks it up, bright red `0xE5484D`), sized to `criticalCount` (the count of `riskBand === 'critical'` instances — beams are for critical only, the loudest tier; watch/elevated get color emphasis but no beam). Position each beam over its critical cabinet (`x, ~4, z`, tall). This is what makes the ~90 critical lines unmissable across the room. If `criticalCount === 0`, skip the beam mesh. The reference look to match is `~/Desktop/Databricks/pcc-3d-scene.png` (colored bays, glow on the machines that matter).

Keep the geometry cheap (shared box) so 1,200 instances hold 60fps. Recompute `scene` bounds to frame all bays in the establishing shot.

- [ ] **Step 3: Implement raycast picking → onSelect(lineId)**

Add a pointerup handler on `renderer.domElement` (guard against drags: compare pointerdown vs up movement > 6px = drag, ignore). Raycast against the cabinet InstancedMesh; on hit read `intersection.instanceId`, map via `instanceLineIds[instanceId]` → build `SelectPayload` from the stored `InstanceModel`, and call the registered `onSelect` callback. Add hover: raise the hovered instance's scale (rebuild just that matrix) and set `cursor: pointer`. Store the callback set by `onSelect(cb)`.

- [ ] **Step 4: Implement `focusLine` (eased camera tween) + hero pulse**

Port the PCC eased-tween technique (no external anime.js dependency): keep a `camTween` state `{ active, t0, dur, fromP, toP, fromT, toT }`; in the animation loop, if active, lerp `camera.position` + `controls.target` with an easeInOutCubic over ~1.2s. `focusLine(lineId)` looks up the instance position and starts a tween to a close orbit offset (e.g. `[x+6, 6, z+10]` targeting `[x, 1, z]`). In the loop, make critical cabinets (and their beams) pulse: modulate the hero instance's scale / beam opacity with `Math.sin(t * 4.5)`. On-load, the view will call `focusLine(heroLineId)` after a short establishing beat (handled in the view, Task 4).

- [ ] **Step 5: Implement `resize` + `dispose`**

`resize()`: recompute `w,h` from container, update `camera.aspect` + `updateProjectionMatrix`, `renderer.setSize`, `labelRenderer.setSize`, `composer.setSize`, `bloom.resolution.set(w,h)`. `dispose()`: cancel the RAF, remove event listeners, `controls.dispose()`, dispose geometries/materials/textures, `renderer.dispose()`, and remove both `renderer.domElement` and `labelRenderer.domElement` from the container. This is critical — React StrictMode double-mounts in dev, and the route is lazy so it mounts/unmounts; a leaked context or duplicated canvas is a real bug.

- [ ] **Step 6: Typecheck + build the client**

Run (from `app/`): `npm run typecheck && npm run build:client`
Expected: clean. **Specifically confirm NO warning mentioning `three/examples/jsm`** and no unresolved `three/addons`. If addons fail to resolve under Vite, confirm the import path is `three/addons/...` and that `three@0.169` is the resolved version.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/scene.ts
git commit -m "feat(plantfloor3d): vanilla-three engine (instanced bays, bloom, pick, camera tween)

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 3: The live-data slide-over (`LineDetailPanel`)

A slide-over panel that, given a `lineId`, fetches the live Lakebase detail and renders the card + the two CTAs. Reuses `fetchLine` (returns snake_case `LineDetail`), `dockController.openAndSend`, and react-router `useNavigate`.

**Files:**
- Create: `app/client/src/plantfloor3d/LineDetailPanel.tsx`

- [ ] **Step 1: Implement the panel**

Props: `{ lineId: string | null; onClose: () => void }`. Behavior:
- When `lineId` changes to non-null, `fetchLine(lineId)` into state (`detail`, `loading`, `error`). Show a skeleton while loading (not a spinner — house style).
- Render as a fixed right-side slide-over (Tailwind: `fixed right-0 top-14 bottom-0 w-[380px] bg-card border-l border-border`, translate-x transition on open/close, above the canvas with a z-index). Header: line name + `plantId` + a `RiskBadge` (reuse `import { RiskBadge } from '@/shared/badges'`).
- Live Lakebase fields from `LineDetail` (snake_case): `failure_risk_score` (as %), `downtime_exposure_usd` ($), `vibration_rms` (mm/s), `temperature_c` (°C), `open_wo_count`, `part_local` (Local / Lead time `part_lead_time_days`d), `machine_type`. Present as a labeled stat grid matching the app (mono numerals, `text-muted-foreground` labels).
- **CTA 1 "Ask the assistant about this line":** on click, `dockController.openAndSend(...)` seeding the hero question, e.g. `` `${detail.line_name} (${detail.line_id}) is trending toward a stop. Pull it now or run it to the end of the shift?` ``. Style as the primary red action (matches OperationsView's assistant CTA).
- **CTA 2 "Open in Operations":** on click, `navigate('/operations?line=' + encodeURIComponent(detail.line_id))`. Secondary style.
- A close button (X) calls `onClose`. No em dashes in any copy.

- [ ] **Step 2: Typecheck**

Run (from `app/`): `npm run typecheck`
Expected: clean. Watch the snake_case vs camelCase seam — `fetchLine` gives `LineDetail` (snake_case); do NOT assume camelCase here.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/LineDetailPanel.tsx
git commit -m "feat(plantfloor3d): live Lakebase slide-over with assist + operations CTAs

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 4: The page/route (`PlantFloor3DView`) + wire into router & sidebar

The React wrapper that owns data + overlay and drives the imperative scene. This is where the tab becomes real and the closed loop lands.

**Files:**
- Create: `app/client/src/plantfloor3d/PlantFloor3DView.tsx`
- Modify: `app/client/src/App.tsx` (lazy route)
- Modify: `app/client/src/shell/AppSidebar.tsx` (nav item)

- [ ] **Step 1: Implement `PlantFloor3DView.tsx`**

Structure:
- A sized container `<div className="relative w-full h-[calc(100vh-3.5rem)] overflow-hidden">` (56px header). A child `<div ref={mountRef} className="absolute inset-0">` is the scene mount (fixed height satisfies the zero-size pitfall).
State: `const [handle, setHandle] = useState<SceneHandle | null>(null)`, `const [allLines, setAllLines] = useState<LineStatus[]>([])`, `const [model, setModel] = useState<SceneModel | null>(null)`, `const [selectedId, setSelectedId] = useState<string | null>(null)`, `const [heroDismissed, setHeroDismissed] = useState(false)`, plus `riskFilter`/`plantFilter`/`loading`/`error`. Use a `handleRef` alongside the state so effects that must not re-run on handle changes can still read the latest handle.

- **Mount effect (empty deps):** detect reduced motion — `const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches` — then `const h = createScene(mountRef.current, { reducedMotion: reduced })`; `h.onSelect(({ lineId }) => setSelectedId(lineId))`; `setHandle(h)` and `handleRef.current = h`. Add a `ResizeObserver` on the container → `h.resize()`. Cleanup: disconnect observer, `h.dispose()`, `setHandle(null)`. (React 18 StrictMode double-invokes effects in dev, so `dispose()` MUST fully tear down — see Task 2 Step 5.)
- **Initial data effect (`[handle]` dep):** guard `if (!handle) return`. Fetch `fetchLines({})` (unfiltered → all 1,200) + `fetchLinesSummary()`; on success `setAllLines(lines)`, compute `const m = linesToScene(lines)`, `setModel(m)`, `handle.setLines(m)`; then after a short establishing beat (`const timer = setTimeout(() => { if (m.heroLineId) handle.focusLine(m.heroLineId); }, reduced ? 0 : 900)`) — return a cleanup that clears the timer. On error `setError(...)`. This runs once the handle exists (handle is created once per mount, so this fires once, not on every render).
- **Hero card:** render the on-load hero risk card (hero line's name/plant/type/failure%/$exposure/part-local, looked up from `allLines` by `model.heroLineId`) as an overlay, shown while `model?.heroLineId && !heroDismissed`. It has an explicit close button → `setHeroDismissed(true)`. Because its visibility is gated on `heroDismissed` state (NOT re-derived from `setLines`), a later filter/refetch does not make it reappear or flash.
- **Live-loop effect (empty deps, reads `handleRef.current`):**
  ```typescript
  useEffect(() => {
    const unsub = dataMutated.subscribe(() => {
      // Agent committed a work order → recolor the floor in place.
      fetchLines({}).then((lines) => {
        setAllLines(lines);
        const h = handleRef.current;
        if (h) { const m = linesToScene(lines); setModel(m); h.setLines(m); }
        // NOTE: do NOT call focusLine here — recolor only, no re-fly-in.
      }).catch(() => { /* keep prior frame on transient error */ });
    });
    return unsub;   // unsubscribe on unmount
  }, []);           // subscribe once; reads latest handle via ref, so no stale closure
  ```
  Applying the active risk/plant filter to the refetched data is done by the shared `applyAndSet(lines)` helper below so the live recolor respects the current filter.
- **Filtering:** a helper `const applyAndSet = (lines: LineStatus[]) => { const filtered = lines.filter(matchesFilters); const m = linesToScene(filtered); setModel(m); handleRef.current?.setLines(m); }` where `matchesFilters` honors `riskFilter`/`plantFilter`. Changing a filter calls `applyAndSet(allLines)` (client-side; all data is already loaded, no refetch). The initial + live-loop effects call `applyAndSet` too so behavior is consistent.
- **Overlay UI** (absolutely positioned over the canvas; give only the interactive controls `pointer-events:auto`, leave the rest `pointer-events:none` so orbit/click reaches the canvas):
  - bottom-left **legend** (critical/elevated/watch/healthy swatches + counts from `model.counts`), styled like the reference render.
  - top-left **filters**: per-risk toggle chips + a plant `<select>` (PLANT-01..08). A "search to focus" input that matches a `lineId`/`lineName` (case-insensitive) and on Enter calls `handleRef.current?.focusLine(matchId)` (keyboard-accessible selection path — Notes).
  - orbit hint bottom-center ("Drag to orbit, scroll to zoom, click a line for detail").
- Render `<LineDetailPanel lineId={selectedId} onClose={() => setSelectedId(null)} />`.
- Loading + error states for the initial fetch (skeleton, and a readable error card if `/api/lines` fails — do not leave a blank canvas with no explanation).

- [ ] **Step 2: Add the lazy route in `App.tsx`**

At the imports, add near the other view imports but as a lazy import (Three.js payload only loads on this route):
```typescript
import { lazy, Suspense } from 'react';
const PlantFloor3DView = lazy(() =>
  import('@/plantfloor3d/PlantFloor3DView').then((m) => ({ default: m.PlantFloor3DView })),
);
```
Add to the children array (after `/operations`):
```typescript
{
  path: '/plant-floor-3d',
  element: (
    <Suspense fallback={<div className="h-[calc(100vh-3.5rem)] bg-muted animate-pulse" />}>
      <PlantFloor3DView />
    </Suspense>
  ),
},
```

- [ ] **Step 3: Add the nav item in `AppSidebar.tsx`**

Import an icon (`Boxes` from `lucide-react`) and add to `navItems` (after Operations):
```typescript
{ to: '/plant-floor-3d', label: 'Plant Floor 3D', icon: Boxes, end: false },
```

- [ ] **Step 4: Typecheck + full build**

Run (from `app/`): `npm run typecheck && npm run build:source`
Expected: clean client + server build, no `three/examples/jsm` warnings, no unresolved imports.

- [ ] **Step 5: Run the unit tests once more (nothing regressed)**

Run (from `app/`): `npm test`
Expected: `lines-to-scene` suite passes; `passWithNoTests` covers the rest.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Databricks/volta-industrial
git add app/client/src/plantfloor3d/PlantFloor3DView.tsx app/client/src/App.tsx app/client/src/shell/AppSidebar.tsx
git commit -m "feat(plantfloor3d): route + sidebar nav + page (fetch, mount, live dataMutated loop)

Co-authored-by: Isaac <no-reply@databricks.com>"
```

---

## Task 5: Deploy + in-browser verification (deployed origin)

The build passing is necessary but not sufficient — a 3D tab is only "done" when it actually renders cabinets in the deployed app and the click/CTA/closed-loop all work. Follow the app's deploy gotchas exactly.

**Files:** none (deploy + verify only).

- [ ] **Step 1: Deploy**

The user must run the push/deploy if the harness classifier blocks the agent (per handoff). Deploy command:
```bash
cd ~/Desktop/Databricks/volta-industrial/app
export DATABRICKS_CONFIG_PROFILE=fe-sandbox-predictive-maintainers
./scripts/deploy.sh
```
(Backgrounded, several minutes. `.env` must NOT contain `DATABRICKS_CONFIG_PROFILE` — export it in the shell as above. Local npm uses the DBX proxy flags already baked into deploy.sh.)

- [ ] **Step 2: Watch for Bug-D (app SP Lakebase role dropped on deploy)**

`databricks apps deploy` can rotate the app SP's Lakebase login → every page 503 with `password authentication failed for 8add3b16...`. `deploy.sh` re-grants and waits up to 90s. If it warns "SP role didn't appear":
```bash
app/scripts/lakebase_grant_app_credential.sh --app-name volta-plant-floor --project-id volta --db-name volta --branch-id development
databricks apps stop volta-plant-floor -p fe-sandbox-predictive-maintainers
databricks apps start volta-plant-floor -p fe-sandbox-predictive-maintainers
```

- [ ] **Step 3: Verify in-browser from the DEPLOYED origin (agent drives the Chrome DevTools MCP)**

The implementing agent runs this verification by driving the Chrome DevTools MCP itself (it is NOT a manual human click-through). The MCP uses its own Chrome profile, separate from the user's daily Chrome. **Human-in-the-loop points:** (a) the deployed app is SSO-gated, so if the page shows a Databricks login the agent pauses and asks the user to complete SSO in the MCP Chrome window, then continues; (b) if the MCP reports the browser is already running, kill the orphaned `chrome-devtools-mcp/chrome-profile` PID and clear its Singleton locks before retrying.

Tool chain (load MCP schemas via ToolSearch first: `mcp__chrome-devtools__navigate_page`, `new_page`, `take_screenshot`, `take_snapshot`, `click`, `list_console_messages`, `evaluate_script`):
  1. `new_page` / `navigate_page` → `https://volta-plant-floor-7474647707959925.aws.databricksapps.com/plant-floor-3d`. `wait_for` the canvas, then `take_screenshot`. PASS = establishing wide shot of all 8 bays with cabinets rendered. FAIL = blank canvas, login card, or error card. (If login card → pause for SSO per above.)
  2. Wait ~1.5s for the fly-in; `take_screenshot`. PASS = camera has flown to the hero (top-exposure critical) line and the hero risk card overlay shows its name/plant/type/failure%/$exposure.
  3. Select a critical cabinet: use `take_snapshot` to get the canvas element, then `click` near a beam, OR (more reliable for a 3D mesh) drive selection through the accessible path — type a known critical `lineId` (e.g. `LINE-0317`) into the search-to-focus box and press Enter, then `click` the cabinet; confirm the slide-over opens. `take_screenshot`. PASS = panel shows LIVE Lakebase fields (failure %, $ exposure, vibration, temp, open WOs, part-local) for that line.
  4. `click` "Ask the assistant about this line"; `take_screenshot`. PASS = the chat dock opens and the hero question is sent.
  5. Re-open the panel, `click` "Open in Operations"; PASS = URL is `/operations?line=…` and the drawer opens on that line (`take_screenshot`).
  6. Closed loop: in the chat dock, approve a work order for a critical line (send the hero question, let the agent draft, approve), return to `/plant-floor-3d`; PASS = that line's color/health updates in 3D after the `dataMutated` refetch (compare before/after `take_screenshot`).
  7. `list_console_messages` → PASS = no WebGL context errors, no failed `/api/*` fetches, no `three/examples/jsm` or unresolved-module errors.
  A login card / blank canvas / any console error is NOT success. Save the screenshots as evidence.

- [ ] **Step 4: Confirm the legacy Operations page still builds + renders**

Navigate to `/operations` in the same session; confirm its (untouched) box-grid 3D still loads and the table/drawer work — proves the new folder didn't disturb the legacy import.

- [ ] **Step 5: Final commit (if any verification fixes were needed) + summary**

If Steps 3-4 surfaced fixes, commit them. Otherwise report the verified state (with screenshots) and the rollback point. Tip before the push: these changes have not been reviewed with Isaac Review yet; the user can run /review before or after pushing.

---

## Notes for the implementer

- **DRY:** reuse `RISK_BAND_HEX` (colors), `fetchLine`/`fetchLines`/`fetchLinesSummary` (data), `RiskBadge` (badges), `dockController` (chat), `dataMutated` (live loop). Do not re-implement any of these.
- **YAGNI (out of scope, per spec):** no live telemetry sparklines, no geospatial map, no replacing the Operations box-grid, no multi-user sync beyond `dataMutated`.
- **Performance:** one InstancedMesh for all cabinets is the whole point — do not create 1,200 meshes. Keep the per-frame loop allocation-free (reuse `THREE.Object3D` dummy + `THREE.Color` temp). Target 60fps; if bloom is heavy on integrated GPUs, the `reducedMotion` option can skip the composer and render directly.
- **Reduced motion:** respect `window.matchMedia('(prefers-reduced-motion: reduce)')` — skip the auto-orbit/pulse and snap the camera instead of tweening (accessibility; also a house design rule).
- **Accessibility:** the canvas is decorative-interactive; provide the same information reachable via the overlay (legend, filters, search-to-focus) and the panel, so a keyboard user can still select a line by search + Enter without needing to click a 3D mesh.
- **Determinism:** the hero pick and instance layout must be stable across refetches (Task 1 tests enforce this) so the closed-loop recolor doesn't reshuffle the floor under the user.
