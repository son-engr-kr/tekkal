# Style Preferences Checklist

**MANDATORY**: When a new deck is first created or its initial content is confirmed, you **must ask the user** about each preference below. Present the options and wait for their choices. Do not assume defaults or skip this step.

Once the user has chosen, apply those choices consistently to all subsequent slides in the same deck without asking again. If adding slides to an **existing deck**, infer the style from existing slides instead of asking.

## 1. Theme

- **Dark** (default): dark background (`#0f172a`), light text
- **Light**: white background, dark text
- **Custom**: ask for specific colors

## 2. Animations

- **Rich**: per-element `onClick` fade-in for step-by-step reveal (each bullet, diagram part, etc.)
- **Minimal**: only `onEnter` fade for whole-slide transitions, no per-element clicks
- **None**: no animations at all

## 3. Highlight Boxes

Red-stroke rectangles/ellipses to emphasize key parts of a diagram or image, faded in via `onClick` animation:

```json
{ "type": "shape", "shape": "rectangle", "style": { "fill": "transparent", "stroke": "#ef4444", "strokeWidth": 3, "borderRadius": 4 } }
```

- **Yes**: add highlight boxes with `onClick` + `fadeIn` animation
- **No**: skip highlight boxes

## 4. Presenter Notes Tone

Ask which style the user prefers. Examples for a slide about "Training Pipeline":

**Option A — Narrative** (conversational academic, as if speaking to audience):
```
Our training has two phases.
[step:1]Phase 1 uses imitation learning. The agent tracks reference joint angles with an activation penalty to generate human-like motion.[/step]
[step:2]Phase 2 starts from the imitation policy and continues training with a new reward. This produces rough terrain walking and speed modulation.[/step]
```

**Option B — Telegraphic** (keyword reminders only):
```
Two-phase training.
[step:1]Phase 1: imitation learning, track ref angles, activation penalty.[/step]
[step:2]Phase 2: fine-tune with new reward → rough terrain, speed modulation.[/step]
```

**Option C — Scripted** (full manuscript, read verbatim):
```
I will now explain our two-phase training pipeline.
[step:1]In the first phase, we employ imitation learning. The agent is trained to track reference joint angle trajectories while minimizing an activation penalty term, which encourages physiologically plausible muscle activation patterns.[/step]
[step:2]In the second phase, we initialize from the imitation-trained policy and continue training with a task-specific reward function. This enables generalization to rough terrain walking and continuous speed modulation.[/step]
```

## 5. Step–Animation Coupling (CRITICAL)

**Every `[step:N]` marker in presenter notes MUST correspond to an `onClick` animation.** Steps start at 1. The N-th `onClick` animation triggers `[step:N]` highlighting.

If a slide has 3 `onClick` animations, the notes should use `[step:1]`, `[step:2]`, `[step:3]`. Mismatched counts cause notes to highlight at the wrong time or never highlight.

When animations are set to "Rich" mode, ensure each visual reveal has a matching `[step:N]` block in the notes explaining what just appeared and why it matters.
