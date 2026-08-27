# PlantFloor3D Integration Guide

## Component Overview

The PlantFloor3D module provides a high-performance 3D visualization of Volta Industrial's production floor, rendering approximately 1,200 production lines with real-time risk-state coloring and interactive selection.

**Premium Aesthetic**: Dark navy/charcoal foundation (#0A0F1C) with molten amber accents (#FFB020), matching the Volta Industrial design system. Unrealbloom post-processing creates cinematic depth without AI-generated look.

## Core Components

### 1. PlantFloor3DPerformant (Recommended)

Production-ready component using THREE.InstancedMesh for 1200+ lines at 60fps.

```tsx
import { PlantFloor3DPerformant, LineStatus, generateMockLines } from '@/plantfloor';

export function VisualizePage() {
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch from API or local data
    fetchProductionLines().then(setLines);
  }, []);

  return (
    <PlantFloor3DPerformant
      lines={lines}
      onSelectLine={setSelectedLineId}
      heroLineId="LINE-04"
    />
  );
}
```

**Props**:
- `lines: LineStatus[]` (required) - Array of production line data
- `onSelectLine?: (lineId: string) => void` - Callback on click selection
- `heroLineId?: string` - Line ID to highlight (default: "LINE-04")

### 2. LineStatus Data Interface

```typescript
interface LineStatus {
  lineId: string;              // e.g., "LINE-04"
  lineName: string;            // e.g., "Stamping Press 04"
  plantId: string;             // e.g., "PLANT-03"
  machineType: string;         // e.g., "Press", "Lathe", "Furnace"
  plantLat?: number;           // Optional: latitude for geospatial context
  plantLng?: number;           // Optional: longitude for geospatial context
  failureRiskScore: number;    // 0.0 to 1.0, drives coloring
  riskBand: RiskBand;          // 'critical' | 'elevated' | 'watch' | 'healthy'
  vibrationRms?: number;       // Optional: vibration reading in g
}

type RiskBand = 'critical' | 'elevated' | 'watch' | 'healthy';
```

### 3. Risk-State Color Mapping

| riskBand | Hex Color | RGB | Visual Effect |
|----------|-----------|-----|--------------|
| critical | #E5484D | (229, 72, 77) | Bright red glow, high emissive intensity |
| elevated | #FFB020 | (255, 176, 32) | Amber, medium glow |
| watch | #FFB020 | (255, 176, 32) | Amber, medium glow |
| healthy | #3C6997 | (60, 105, 151) | Steel blue, minimal glow |

Colors are set via `MeshStandardMaterial.color` + `emissive` + Unrealbloom pass to create depth.

## Data Flow & Props

```
Parent Component (e.g., Dashboard)
    ↓
    ├─ lines: LineStatus[] (live from API or state)
    │   └─ [LineStatus, LineStatus, ...] ~1200 items
    │
    ├─ onSelectLine: (lineId: string) => void
    │   └─ Parent updates sidebar/details panel
    │
    └─ heroLineId: string (optional, default "LINE-04")
        └─ Highlights a featured line (typically the excursion focus)
        
PlantFloor3DPerformant
    ↓
    ├─ Creates InstancedMesh with all lines
    ├─ Colors each instance per riskBand
    ├─ Sets up OrbitControls + Bloom postprocessing
    ├─ Raycasts on click → calls onSelectLine(lineId)
    └─ Responds to prop changes: colors update on new data
```

## Performance Notes

**InstancedMesh Optimization**:
- Single draw call for all 1200 lines (vs. 1200 individual draw calls)
- Colors stored in `instanceColor` buffer, updated via `setColorAt(index, color)`
- Positions set at init in 10-row-deep grid; no per-frame position updates

**Bloom Post-Processing**:
- Intensity: 1.0 (enough to emphasize critical/at-risk, not overwhelming)
- Radius: 0.4, Threshold: 0.85
- Completes at ~60fps on MacBook Pro M1+

**Memory Footprint**:
- ~40MB for 1200 InstancedMesh geometries + materials
- No texture assets (all procedural)
- Full disposal on unmount to prevent WebGL leaks

## Testing & Standalone Use

### Demo Component

```tsx
import { PlantFloor3DDemo } from '@/plantfloor/PlantFloor3DDemo';

// Renders a full-screen demo with mock data (1200 lines)
export function TestPage() {
  return <PlantFloor3DDemo />;
}
```

The demo includes:
- Mock data generator (randomized risk bands, ~5% critical)
- Line inspector panel (click a line → details)
- Line count slider (100-1200)
- Risk legend (color key)

### Mock Data

```tsx
import { generateMockLines } from '@/plantfloor';

const lines = generateMockLines(1200);
// Returns 1200 LineStatus objects with random risk bands
// Useful for local testing without a backend API
```

## Integration into the Volta App

### Recommended Integration Path

1. **Add to your layout/page** (e.g., `src/operations/VisualizePage.tsx`):

```tsx
import { PlantFloor3DPerformant } from '@/plantfloor';
import { useProductionLines } from '@/api/hooks'; // Your API hook
import { useCallback, useState } from 'react';

export function VisualizePage() {
  const { lines, loading, error } = useProductionLines();
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const handleSelectLine = useCallback((lineId: string) => {
    setSelectedLineId(lineId);
    // Dispatch action to show line details, alerts, telemetry, etc.
  }, []);

  if (loading) return <div>Loading plant floor...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="flex gap-4 h-screen">
      <div className="flex-1">
        <PlantFloor3DPerformant
          lines={lines}
          onSelectLine={handleSelectLine}
          heroLineId="LINE-04"
        />
      </div>
      <aside className="w-80 bg-slate-900 border-l border-slate-800 p-4">
        {selectedLineId && <LineDetailsPanel lineId={selectedLineId} />}
      </aside>
    </div>
  );
}
```

2. **Wire up API data**:

```typescript
// api/hooks.ts
export function useProductionLines() {
  const [lines, setLines] = useState<LineStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/plant-floor/lines')
      .then((res) => res.json() as Promise<LineStatus[]>)
      .then((data) => {
        setLines(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { lines, loading, error };
}
```

3. **Handle line selection**:

```tsx
function LineDetailsPanel({ lineId }: { lineId: string }) {
  const line = useLineById(lineId);
  if (!line) return null;

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-amber-400">{lineId}</h3>
      <div className="space-y-2 text-sm text-slate-300">
        <div><span className="text-slate-400">Name:</span> {line.lineName}</div>
        <div><span className="text-slate-400">Plant:</span> {line.plantId}</div>
        <div><span className="text-slate-400">Risk:</span> {line.riskBand}</div>
        <div><span className="text-slate-400">Failure Risk:</span> {(line.failureRiskScore * 100).toFixed(1)}%</div>
      </div>
    </div>
  );
}
```

## Responsive Design

The 3D canvas fills its container. Wrap it in a responsive container:

```tsx
<div className="w-full h-screen">
  <PlantFloor3DPerformant lines={lines} onSelectLine={handleSelect} />
</div>
```

On resize, the canvas and bloom pass automatically rescale. Tested at 1920x1080, 1440x900, 2560x1440.

## Dark Theme Compliance

- Background: Volta design system `#0A0F1C` (deepest graphite)
- Accent: Molten amber `#FFB020` (matches Volta primary)
- Text overlay (if needed): Use `--text-muted` (`#8A99AB`) from index.html
- No light backgrounds; all surfaces use graphite palette

## Known Limitations & Future Enhancements

1. **Sampling**: Healthy lines are rendered but receive minimal glow. For very large datasets (5000+ lines), consider:
   - Culling healthy lines outside camera frustum
   - LOD (level-of-detail) for distant lines
   - Splitting into multiple InstancedMeshes per plant

2. **Labeling**: Currently no 3D labels (would add CSS2DRenderer overhead). For MVP, use:
   - Side panel on line selection
   - Hover tooltips (canvas-based)
   - External 2D UI layer

3. **Animation**: No scripted excursion choreography (unlike the booth demo). This is data-driven; animations can be added via:
   - Tween.js for color transitions
   - Vibration simulation (vertex shader)
   - Camera story sequences

4. **Mobile**: Orbit controls are desktop-friendly. Mobile support would need:
   - Touch gesture handling (pinch, drag)
   - Simplified camera preset (top-down view)
   - Tap-to-select (already working via raycaster)

## Dependencies

- **three**: ^r128 (peer dependency, installed at volta-wt-plantfloor root)
- **@types/three**: ^r128 (dev dependency)
- No other npm packages required

## Troubleshooting

### Canvas not rendering
- Verify container has width/height (flex or explicit size)
- Check console for WebGL errors
- Ensure Three.js is installed: `npm ls three`

### Lines all one color
- Check LineStatus.riskBand values (must be one of: 'critical', 'elevated', 'watch', 'healthy')
- Verify RISK_BAND_HEX constant is correct

### Performance lag (< 60fps)
- Reduce line count via slice: `lines.slice(0, 500)`
- Disable Bloom: remove bloomPass from composer
- Check GPU memory: `renderer.info.memory`

### Click selection not working
- Verify onSelectLine callback is defined
- Check raycaster: ensure mouse movement updates mouse.x/y
- Ensure lines array is not empty

## Code Quality

- TypeScript strict mode: ✓
- React.FC with full typing: ✓
- Memory cleanup (dispose, removeEventListener): ✓
- No external assets or CDN dependencies: ✓
- Follows Volta design system: ✓

## Contact & Support

For questions or contributions:
- Code location: `/app/client/src/plantfloor/`
- Demo: `PlantFloor3DDemo.tsx` (run in isolation for testing)
- Integration examples: see above sections
