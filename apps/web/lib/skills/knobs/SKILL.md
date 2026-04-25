---
name: knobs
description: Add interactive controls (sliders, switches, selects, color pickers, text inputs) that show up in a popover next to the artboard's "interact" button. Use whenever the user asks to expose a value as something they can tweak live ("make the padding adjustable", "let me toggle dark mode", "add a slider for X", "expose this as a knob").
---

# Skill: Adding knobs

Knobs are interactive controls that show up in a popover next to the
"interact" button at the top of an artboard. Each knob is declared from
the prototype's own code; screenplay renders the right shadcn input for
its declared type and syncs the value across clients via Yjs.

## How to add a knob

The `screenplay-knobs` package is **already installed** in this sandbox
at `node_modules/screenplay-knobs/`. **Do not** add it to
`package.json`, run `npm install screenplay-knobs`, or copy any helper
file into the repo — just import it.

```tsx
import { useKnob } from "screenplay-knobs"

export function Card() {
  const padding = useKnob({
    id: "card-padding",
    type: "slider",
    label: "Padding",
    min: 0,
    max: 64,
    step: 2,
    default: 16,
  })

  const showShadow = useKnob({
    id: "card-shadow",
    type: "boolean",
    label: "Drop shadow",
    default: true,
  })

  return (
    <div
      style={{ padding, boxShadow: showShadow ? "0 2px 8px #0002" : "none" }}
    >
      …
    </div>
  )
}
```

That's it. Save, commit, push. The popover picks up the new knob
automatically — no manifest, no registration.

## Knob types

Each knob declares a `type` that selects a shadcn input on the canvas:

| `type`     | UI control     | Required fields                                     |
| ---------- | -------------- | --------------------------------------------------- |
| `slider`   | Slider         | `min`, `max`, `default` (number); `step?`           |
| `number`   | Numeric input  | `default` (number); `min?`, `max?`, `step?`         |
| `boolean`  | Switch         | `default` (boolean)                                 |
| `string`   | Text input     | `default` (string); `placeholder?`                  |
| `select`   | Select         | `default` (string); `options: { value, label? }[]`  |
| `color`    | Color picker   | `default` (string, e.g. `"#1d4ed8"`)                |

All knobs accept an optional `label` (defaults to the `id`) and an
optional `validator: (v) => v` that runs locally inside the prototype on
every incoming value — use it to clamp or sanitize before exposing the
value to your component.

## Rules

- **Don't add `screenplay-knobs` to `package.json`.** The package is
  pre-installed in `node_modules/`. Adding it as a dependency would
  break the user's repo on a clean clone.
- **Don't write a helper file.** There is no `screenplay-knobs.ts` to
  create or copy. Just import from `"screenplay-knobs"`.
- **Stable `id`**: the canvas keys persisted values by `id`. Renaming
  an id resets the value to its `default`.
- **Pure declarations**: `useKnob` must run on every render with the
  same definition. Don't conditionally call it.
- **Functions don't cross frames**: `validator` runs only inside the
  prototype. Min/max/step/options are what the canvas's UI sees.
- **Non-React prototype?** Use `registerKnob(def, onChange)` from the
  same package — it runs the callback every time the value changes and
  returns an unsubscribe function.
