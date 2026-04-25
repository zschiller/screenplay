# Skill: Adding knobs

Knobs are interactive controls that show up in a popover next to the
"interact" button at the top of the artboard. Each knob is declared from
the prototype's own code; screenplay renders the right shadcn input for
its declared type and syncs the value across clients via Yjs. Use this
when the user asks for a way to tweak a value live ("make the padding
adjustable", "let me toggle dark mode", "add a slider for the spacing",
"expose this as a knob", etc.).

## How to add a knob

1. Make sure the helper file exists in the prototype. If
   `src/screenplay-knobs.tsx` (or equivalent path inside the project)
   isn't there yet, create it with the contents shown in the **Helper
   file** section below. Re-use the same file for every knob you add —
   don't duplicate it.

2. In the component you want to control, import `useKnob` from that
   file and call it. The return value is the live value of the knob —
   the canvas's popover edits it, your component re-renders.

   ```tsx
   import { useKnob } from "./screenplay-knobs"

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

3. That's it. Save, commit, push. The popover will pick up the new knob
   automatically — there's no manifest to register.

## Knob types

Each knob declares a `type` that selects a shadcn input on the canvas:

| `type`     | UI control | Required fields                            |
| ---------- | ---------- | ------------------------------------------ |
| `slider`   | Slider     | `min`, `max`, `default` (number); `step?`  |
| `number`   | Input      | `default` (number); `min?`, `max?`, `step?`|
| `boolean`  | Switch     | `default` (boolean)                        |
| `string`   | Input      | `default` (string); `placeholder?`         |
| `select`   | Select     | `default` (string); `options: { value, label? }[]` |
| `color`    | Color picker | `default` (string, e.g. `"#1d4ed8"`)     |

All knobs accept an optional `label` (defaults to the `id`) and an
optional `validator: (v) => v` that runs locally inside the prototype on
every incoming value — use it to clamp or sanitize before exposing the
value to your component.

## Rules

- **Stable `id`**: the canvas keys persisted values by `id`. Renaming an
  id resets the value to its `default`.
- **Pure declarations**: `useKnob` must run on every render with the
  same definition. Don't conditionally call it.
- **Functions don't cross frames**: `validator` runs only inside the
  prototype. Min/max/step/options are what the canvas's UI sees.
- **One helper file**: import every knob through the same
  `screenplay-knobs.tsx`. Don't reimplement it per-component.

## Helper file

Create this once at `src/screenplay-knobs.tsx` (adjust the path for the
project's layout — it just needs to live somewhere components can import
from). The file is self-contained: zero deps beyond React.

```tsx
{{HELPER_SOURCE}}
```
