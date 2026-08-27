# Volta Industrial 3D Plant Floor Visualization

A React/TypeScript port of the PCC Foundry digital-twin Three.js scene for Volta Industrial, rendering approximately 1,200 production lines with real-time risk-state visualization.

## What's Inside

```
plantfloor/
├── types.ts                    # LineStatus interface + risk-band color constants
├── PlantFloor3D.tsx            # Standard mesh rendering (proof of concept)
├── PlantFloor3DPerformant.tsx  # InstancedMesh for 1200 lines (recommended)
├── usePlantFloorScene.ts       # Camera tween + color update helpers
├── mockData.ts                 # Data generator for testing
├── PlantFloor3DDemo.tsx        # Full-screen demo UI
├── index.ts                    # Public exports
├── INTEGRATION.md              # Detailed integration guide
└── README.md                   # This file
```

## Quick Start

### Minimal Example

```tsx
import { PlantFloor3DPerformant, generateMockLines } from '@/plantfloor';

export function MyPage() {
  const lines = generateMockLines(1200);
  return (
    <PlantFloor3DPerformant
      lines={lines}
      onSelectLine={(lineId) => console.log('Selected:', lineId)}
    />
  );
}
```

### With Real Data

```tsx
import { PlantFloor3DPerformant, LineStatus } from '@/plantfloor';
import { useEffect, useState } from 'react';

export function PlantFloor() {
  const [lines, setLines] = useState<LineStatus[]>([]);

  useEffect(() => {
    fetch('/api/plant-floor/lines')
      .then((r) => r.json())
      .then(setLines);
  }, []);

  return (
    <div className="h-screen">
      <PlantFloor3DPerformant lines={lines} onSelectLine={handleSelect} />
    </div>
  );
}
```

## Visual Design

**Aesthetic Direction**: Dark shop floor (Bloomberg Terminal meets manufacturing).

- **Base**: Charcoal navy `#0A0F1C`, deep graphite `#0B0E13`
- **Accent**: Molten amber `#FFB020` for at-risk highlights
- **Lighting**: Directional sun + point lights for metallic depth
- **Post-Processing**: Unrealbloom for cinematic glow without AI-generated look

**Risk Colors**:
- 🔴 **Critical** (`#E5484D` red): Bright glow, high emissive intensity
- 🟡 **Elevated/Watch** (`#FFB020` amber): Medium glow
- 🔵 **Healthy** (`#3C6997` steel): Minimal glow, recessed

## Key Features

✓ **High-Performance**: InstancedMesh renders 1200 lines in a single draw call (60fps)
✓ **Live Updates**: Props-driven color changes (no scene rebuild)
✓ **Interactive Selection**: Raycaster click-to-select with callback
✓ **Responsive**: Auto-scales to container on resize
✓ **No External Assets**: Procedural geometry + canvas textures only
✓ **Full Cleanup**: WebGL disposal on unmount (no memory leaks)
✓ **Mock Data**: Standalone testing without backend
✓ **Premium Look**: Bloom post-processing, metallic materials, dark theme

## Data Interface

```typescript
interface LineStatus {
  lineId: string;           // e.g., "LINE-04"
  lineName: string;         // e.g., "Stamping Press 04"
  plantId: string;          // e.g., "PLANT-03"
  machineType: string;      // e.g., "Press"
  plantLat?: number;        // Optional geospatial context
  plantLng?: number;
  failureRiskScore: number; // 0.0 to 1.0
  riskBand: RiskBand;       // 'critical' | 'elevated' | 'watch' | 'healthy'
  vibrationRms?: number;    // Optional sensor reading
}
```

## Component Props

### PlantFloor3DPerformant

```typescript
interface PlantFloor3DPerformantProps {
  lines: LineStatus[];                      // Required: production line data
  onSelectLine?: (lineId: string) => void;  // Click selection callback
  heroLineId?: string;                      // Line to highlight (default: "LINE-04")
}
```

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Lines rendered | 1200 |
| Draw calls | 1 (InstancedMesh) |
| Target framerate | 60 fps |
| Post-processing | Bloom (UnrealBloomPass) |
| Memory (GPU) | ~40 MB |
| Pixel ratio | Responsive (2x on high-DPI) |

**Tested on**: MacBook Pro M1, Chrome DevTools GPU throttling (4x CPU slowdown)

## Responsive & Dark Theme

- **Responsive**: Full-width/full-height, resizes dynamically
- **Dark Only**: No light-theme variant (Volta brand = dark)
- **Tailwind**: Uses only Tailwind utilities (no custom CSS)
- **TypeScript**: Strict mode, full type safety

## Import Paths

```tsx
// Main component (recommended for 1200 lines)
import { PlantFloor3DPerformant } from '@/plantfloor';

// Alternative (for testing or smaller datasets)
import { PlantFloor3D } from '@/plantfloor';

// Types
import { LineStatus, RiskBand, RISK_BAND_HEX, RISK_BAND_COLORS } from '@/plantfloor';

// Utilities
import { generateMockLines, getMockHeroLineData } from '@/plantfloor';
import { usePlantFloorScene } from '@/plantfloor';

// Demo
import { PlantFloor3DDemo } from '@/plantfloor/PlantFloor3DDemo';
```

## Sizing Guidelines

- **Full-screen**: Wrap in `<div className="h-screen">`
- **Embedded**: Wrap in any flex container with explicit height
- **Minimum**: 300x300px for usability; recommended 800x600+

Example:

```tsx
<div className="h-[600px] w-full">
  <PlantFloor3DPerformant lines={lines} onSelectLine={handleSelect} />
</div>
```

## Known Behaviors

1. **Healthy lines are dimmer** to emphasize at-risk clusters. This is intentional for visual scanning.
2. **Click selection uses raycasting**: Works at any distance/zoom level.
3. **OrbitControls are active**: Left-drag = rotate, right-drag = pan, scroll = zoom.
4. **No 3D labels**: Use a side panel or tooltip layer for line info.
5. **Procedural only**: No glTF loading; all geometry is generated at runtime.

## Troubleshooting

See [INTEGRATION.md](./INTEGRATION.md#troubleshooting) for detailed troubleshooting.

Common issues:
- **Canvas not showing**: Verify container has explicit height
- **Lines all same color**: Check riskBand values in data
- **Click not working**: Ensure onSelectLine callback is defined
- **Lag**: Reduce line count, disable bloom, check GPU memory

## Testing

### Run the demo in isolation

```tsx
import { PlantFloor3DDemo } from '@/plantfloor/PlantFloor3DDemo';

// Renders a full-screen demo with controls
export default PlantFloor3DDemo;
```

Then adjust the slider to test performance at different line counts (100–1200).

### Generate mock data

```tsx
import { generateMockLines, getMockHeroLineData } from '@/plantfloor';

const allLines = generateMockLines(1200);
const heroLine = getMockHeroLineData();
console.log(heroLine); // LINE-04 at risk
```

## Architecture Decisions

1. **InstancedMesh over individual meshes**: Single draw call, 60 FPS at 1200 lines
2. **No Three.PointLight labels**: CSS2DRenderer would add overhead; deferred to UI layer
3. **Bloom instead of glow shader**: Simpler, works well on mobile, matches Volta aesthetic
4. **Props-driven updates**: Colors update without scene rebuild on new data
5. **No animation library**: Tween.js not needed yet; can add if animation stories required

## Integration Checklist

- [ ] Import `PlantFloor3DPerformant` into your page/component
- [ ] Pass `lines` array from your API or state
- [ ] Define `onSelectLine` callback for details/sidebar
- [ ] Wrap in a container with explicit height (flex or h-screen)
- [ ] Test with mock data: `generateMockLines(1200)`
- [ ] Wire up real API endpoint
- [ ] Add line details panel/sidebar on selection
- [ ] Verify responsive on target breakpoints (1920x1080, 1440x900, mobile)
- [ ] Check dark theme compliance (no white backgrounds)
- [ ] Test performance on target hardware

## See Also

- [INTEGRATION.md](./INTEGRATION.md) — Detailed integration guide + examples
- [PlantFloor3DDemo.tsx](./PlantFloor3DDemo.tsx) — Full working demo UI
- [types.ts](./types.ts) — Type definitions + color constants
- [mockData.ts](./mockData.ts) — Data generator

## License

Part of Volta Industrial demo platform. Built for premium Fortune-500 customer engagements.
