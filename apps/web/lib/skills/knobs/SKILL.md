---
name: knobs
description: Add interactive controls (sliders, switches, selects, color pickers, text inputs) that show up in a popover next to the artboard's "interact" button. Use whenever the user asks to expose a value as something they can tweak live ("make the padding adjustable", "let me toggle dark mode", "add a slider for X", "expose this as a knob").
---

# Skill: Adding knobs

Knobs are interactive controls that show up in a popover next to the
"interact" button at the top of an artboard. The prototype declares
each knob; screenplay renders the right shadcn input for its type and
syncs the value across clients via Yjs. When the prototype runs
outside a screenplay canvas (production builds, standalone dev, etc.)
the knob just returns its declared default — committing knob code is
safe.

## How to add a knob

1. **Make sure `@screenplay.space/knobs` is installed.** Read
   `package.json`. If it isn't listed in `dependencies`, install it:

   ```
   run_command "npm" ["install", "--save", "@screenplay.space/knobs"]
   ```

   Skip this step if it's already there.

2. **Import `useKnob` and call it.** The return value is the live value
   of the knob.

   ```tsx
   import { useKnob } from "@screenplay.space/knobs"

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
         style={{
           padding,
           boxShadow: showShadow ? "0 2px 8px #0002" : "none",
         }}
       >
         …
       </div>
     )
   }
   ```

3. **Commit and push.** The popover picks up the new knob automatically
   — no manifest, no registration.

## Knob types

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

- **Always run `npm install --save @screenplay.space/knobs` before
  using `useKnob` for the first time** — committing an import without
  the dep listed in `package.json` would break the user's build on a
  fresh clone.
- **Stable `id`**: the canvas keys persisted values by `id`. Renaming
  an id resets the value to its `default`.
- **Pure declarations**: `useKnob` must run on every render with the
  same definition. Don't conditionally call it.
- **Functions don't cross frames**: `validator` runs only inside the
  prototype. Min/max/step/options are what the canvas's UI sees.
- **Non-React prototype?** Use `registerKnob(def, onChange)` from the
  same package — it runs the callback on every value change and returns
  an unsubscribe function.
