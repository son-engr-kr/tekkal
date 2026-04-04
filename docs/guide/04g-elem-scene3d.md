# Scene3D Elements

## `"scene3d"`

Renders an interactive 3D scene using Three.js (React Three Fiber). Supports multiple geometry types, PBR materials, camera controls, and keyframe animations.

### `scene` (Scene3DConfig) — required

| Field | Type | Description |
|-------|------|-------------|
| `camera` | object | Position `[x,y,z]`, target `[x,y,z]`, fov. Default: pos `[5,5,5]`, target `[0,0,0]`, fov `50` |
| `background` | string | Hex color. Omit for transparent (slide background shows through) |
| `ambientLight` | number | Intensity 0-1. Default: `0.5` |
| `directionalLight` | object | `{ position: [x,y,z], intensity? }`. Default intensity: `0.8` |
| `objects` | array | Array of Scene3DObject (required) |
| `helpers` | object | `{ grid?: boolean, axes?: boolean }` |
| `orbitControls` | boolean | Enable drag-to-rotate. Default: `false` |

**Scene3DObject**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID used by keyframe `target` (required) |
| `geometry` | string | `"box"` \| `"sphere"` \| `"cylinder"` \| `"cone"` \| `"torus"` \| `"plane"` \| `"line"` \| `"surface"` (required) |
| `position` | `[x,y,z]` | Default: `[0,0,0]` |
| `rotation` | `[x,y,z]` | Euler radians. Default: `[0,0,0]` |
| `scale` | `[x,y,z]` | Default: `[1,1,1]` |
| `material` | object | See Material table below |
| `label` | string | Text label near the object |
| `visible` | boolean | Default: `true` |
| `points` | `[x,y,z][]` | Line geometry only: array of 3D points |
| `surface` | object | Surface geometry only: `{ fn, xRange, zRange, resolution, colorRange }` |

**Material**:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `color` | string | `"#ffffff"` | Hex color |
| `opacity` | number | `1` | 0-1 |
| `wireframe` | boolean | `false` | Render as wireframe |
| `metalness` | number | `0` | 0-1 |
| `roughness` | number | `0.5` | 0-1 |

### `keyframes` — optional

```json
{
  "keyframes": [
    {
      "duration": 800,
      "camera": { "position": [0, 5, 6] },
      "changes": [
        { "target": "cube", "rotation": [0, 0.785, 0] },
        { "target": "sphere", "visible": true }
      ]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `duration` | number | Transition ms |
| `camera` | object | Camera changes: `position`, `target`, `fov` |
| `changes[].target` | string | Object ID to modify (required) |
| `changes[].position/rotation/scale` | `[x,y,z]` | New transform values |
| `changes[].material` | object | Material property changes (merged) |
| `changes[].visible` | boolean | Show/hide object |
| `changes[].points` | `[x,y,z][]` | New points for `"line"` geometry |
| `changes[].surface` | object | Partial surface update (merged) for `"surface"` geometry |

Keyframes are cumulative: each step applies on top of previous state.

### Keyframe Animation Wiring

Add `scene3dStep` animations to advance keyframes on click. Entry count must match keyframe count.

```json
{
  "animations": [
    { "target": "my-scene", "trigger": "onEnter", "effect": "scaleIn", "duration": 500 },
    { "target": "my-scene", "trigger": "onClick", "effect": "scene3dStep", "order": 1 },
    { "target": "my-scene", "trigger": "onClick", "effect": "scene3dStep", "order": 2 },
    { "target": "my-scene", "trigger": "onClick", "effect": "scene3dStep", "order": 3 }
  ]
}
```

### Style

| Field | Default | Description |
|-------|---------|-------------|
| `borderRadius` | `0` | Corner radius in px |

### Tips

- **Transparent background**: Omit `scene.background` so the slide background shows through.
- **Floor plane**: Use `"plane"` geometry with rotation `[-1.5708, 0, 0]` for a horizontal floor.
- **Orbit controls**: Enable for interactive scenes; disable when keyframe camera animations should not be overridden.
- **Thumbnails**: Scene3D renders a static SVG placeholder in thumbnails to avoid WebGL overhead.
- **Hidden objects**: Set `"visible": false` initially, reveal via keyframe `{ "target": "id", "visible": true }`.
