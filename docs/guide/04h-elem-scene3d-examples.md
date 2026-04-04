# Scene3D Examples

### Complete scene3d example (interactive with keyframes)

```json
{
  "id": "s3d-main",
  "type": "scene3d",
  "position": { "x": 60, "y": 100 },
  "size": { "w": 520, "h": 380 },
  "scene": {
    "camera": { "position": [4, 3, 4], "target": [0, 0, 0], "fov": 50 },
    "ambientLight": 0.4,
    "directionalLight": { "position": [5, 10, 5], "intensity": 0.9 },
    "objects": [
      {
        "id": "cube",
        "geometry": "box",
        "position": [0, 0.5, 0],
        "material": { "color": "#60a5fa", "metalness": 0.3, "roughness": 0.5 }
      },
      {
        "id": "sphere",
        "geometry": "sphere",
        "position": [2, 0.5, 0],
        "scale": [0.8, 0.8, 0.8],
        "material": { "color": "#fbbf24", "metalness": 0.5, "roughness": 0.3 },
        "visible": false
      },
      {
        "id": "floor",
        "geometry": "plane",
        "position": [0, 0, 0],
        "rotation": [-1.5708, 0, 0],
        "scale": [6, 6, 1],
        "material": { "color": "#e8edf5", "roughness": 0.8 }
      }
    ],
    "orbitControls": true,
    "helpers": { "grid": true, "axes": true }
  },
  "keyframes": [
    {
      "duration": 800,
      "camera": { "position": [0, 5, 6] },
      "changes": [
        { "target": "cube", "rotation": [0, 0.785, 0] }
      ]
    },
    {
      "duration": 600,
      "changes": [
        { "target": "sphere", "visible": true },
        { "target": "cube", "material": { "color": "#a78bfa" } }
      ]
    },
    {
      "duration": 700,
      "camera": { "position": [5, 2, 5] },
      "changes": [
        { "target": "sphere", "position": [2, 1.5, 0], "material": { "color": "#f87171" } },
        { "target": "cube", "scale": [1.3, 1.3, 1.3] }
      ]
    }
  ],
  "style": { "borderRadius": 12 }
}
```

Pair with these animations on the slide:
```json
{
  "animations": [
    { "target": "s3d-main", "trigger": "onEnter", "effect": "scaleIn", "duration": 500 },
    { "target": "s3d-main", "trigger": "onClick", "effect": "scene3dStep", "order": 1 },
    { "target": "s3d-main", "trigger": "onClick", "effect": "scene3dStep", "order": 2 },
    { "target": "s3d-main", "trigger": "onClick", "effect": "scene3dStep", "order": 3 }
  ]
}
```

## `"reference"`

A reference to a shared component defined in `deck.components`. Renders the component's child elements, scaled to fit the reference's size. A small badge shows the component name in the editor.

```json
{
  "id": "e50",
  "type": "reference",
  "componentId": "comp-a1b2c3d4",
  "position": { "x": 100, "y": 200 },
  "size": { "w": 300, "h": 90 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `componentId` | string | yes | ID of the shared component in `deck.components` |

**Notes:**
- Duplicating a reference creates another pointer to the same component (new element ID, same `componentId`).
- Animations treat a reference as an atomic unit — individual child animations are not supported.
- References do not have a `style` property or `groupId`.

