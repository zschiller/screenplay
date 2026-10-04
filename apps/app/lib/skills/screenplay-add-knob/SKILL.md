---
name: screenplay-add-knob
description: Add knobs, live controls (slider, switch, select, tabs, colour, text) in the Knobs panel beside a frame or Mockup. Use when the user asks to make a value adjustable, toggleable or tweakable live.
---

# Skill: Adding knobs

A **knob** is a live control in the Knobs panel beside a frame or Mockup.
The page declares each knob; Screenplay renders the control for its type and
syncs its value to everyone on the canvas. Outside a canvas (a production
build, plain local dev) a knob returns its `default`, so knob code is safe
to commit.

Where the knob goes decides how you declare it: **app code** in your
Workspace uses the `@screenplay.space/knobs` package; a **Mockup** uses the
`screenplay` global its page already has. Both take the same definitions.

## In app code

1. Read `package.json`. When `@screenplay.space/knobs` isn’t in
   `dependencies`, install it first, so a fresh clone still builds:

   ```
   run_command "npm" ["install", "--save", "@screenplay.space/knobs"]
   ```

2. Call `useKnob` on every render with the same definition; it returns the
   live value. Outside React, `registerKnob(def, onChange)` from the same
   package calls `onChange` on every change and returns an unsubscribe.

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
     return <div style={{ padding }}>…</div>
   }
   ```

The panel picks up a new knob as soon as the page renders it.

## On a Mockup

The page already has `screenplay.registerKnob(def, onChange)`: `onChange`
runs at once with the current value and again on every change. Each value
is also set on `:root` as `--knob-<id>`, so a knob can drive CSS alone.
Add knobs by rewriting the page with `update_mockup`.

```html
<style>
  .card {
    padding: calc(var(--knob-card-padding, 16) * 1px);
  }
</style>
<script>
  screenplay.registerKnob({
    id: "card-padding",
    type: "slider",
    label: "Padding",
    min: 0,
    max: 64,
    step: 2,
    default: 16,
  })
  screenplay.registerKnob(
    { id: "card-shadow", type: "boolean", label: "Drop shadow", default: true },
    (on) => document.body.classList.toggle("shadow", on)
  )
</script>
```

## Definitions

| `type`    | Control       | Fields                                             |
| --------- | ------------- | -------------------------------------------------- |
| `slider`  | Slider        | `min`, `max`, `default` (number); `step?`          |
| `number`  | Numeric input | `default` (number); `min?`, `max?`, `step?`        |
| `boolean` | Switch        | `default` (boolean)                                |
| `string`  | Text input    | `default` (string); `placeholder?`                 |
| `select`  | Select        | `default` (string); `options: { value, label? }[]` |
| `tabs`    | Tabs          | `default` (string); `options: { value, label? }[]` |
| `color`   | Colour picker | `default` (string, e.g. `"#1d4ed8"`)               |

- **`id`** is the key the canvas stores the value under, so keep it stable:
  a renamed id resets to its `default`.
- **`label`**: a short noun phrase for what changes (“Corner radius”, “Show
  customer logos”).
- **`description`** (optional): one short phrase on what the knob affects,
  shown in a tooltip after the label (“Buttons, cards and inputs”), only
  when the label alone leaves people guessing.
- **`group`** (optional): knobs sharing a `group` sit under one heading, in
  the order its first knob was declared; ungrouped knobs come first. Group
  once a page has more than about five knobs, by the part of the page they
  change (“Brand”, “Hero”), with several knobs per group.
- **`validator`** (optional, app code only): `(v) => v`, run inside the page
  on every incoming value to clamp it. The panel sees only the plain fields.

## Tabs or select

Both pick one of a few options. Use `tabs` when every option fits at a
glance and switching is the point (light / dark, grid / list, S / M / L):
two or three options of one short word each, about 15 characters across all
labels, so they fit the panel’s 136px control column. Anything longer is a
`select`.
