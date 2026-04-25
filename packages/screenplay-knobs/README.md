# @screenplay.space/knobs

Declare interactive controls (sliders, switches, selects, color pickers, text inputs) from a prototype's own code. They show up in a popover on the screenplay canvas next to the artboard's "interact" button. Knob state syncs across viewers in real time.

When the prototype is rendered outside a screenplay canvas — production, standalone dev, anything that isn't an iframed sandbox — `useKnob` quietly returns the declared `default`. So shipping knobs in committed code is safe.

## Install

```bash
npm install --save @screenplay.space/knobs
```

`react >= 17` is a peer dependency.

## Use

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

Stable `id`s persist values across reloads. Renaming an `id` resets the value to its `default`.

## Knob types

| `type`    | UI control     | Required fields                                      |
| --------- | -------------- | ---------------------------------------------------- |
| `slider`  | Slider         | `min`, `max`, `default` (number); `step?`            |
| `number`  | Numeric input  | `default` (number); `min?`, `max?`, `step?`          |
| `boolean` | Switch         | `default` (boolean)                                  |
| `string`  | Text input     | `default` (string); `placeholder?`                   |
| `select`  | Select         | `default` (string); `options: { value, label? }[]`   |
| `color`   | Color picker   | `default` (string, e.g. `"#1d4ed8"`)                 |

All knobs accept an optional `label` (defaults to the `id`) and an optional `validator: (v) => v` that runs locally inside the prototype on every incoming value — use it to clamp or sanitize before exposing the value to your component.

## Non-React API

```ts
import { registerKnob } from "@screenplay.space/knobs"

const unsubscribe = registerKnob(
  { id: "background", type: "color", default: "#ffffff" },
  (value) => {
    document.body.style.background = String(value)
  },
)
```

## Releasing

Publishing is automated via the **Publish @screenplay.space/knobs** workflow in
GitHub Actions (`.github/workflows/publish-knobs.yml`). Open the Actions tab,
pick that workflow, and click **Run workflow**:

- **bump** — `patch`, `minor`, `major`, `prerelease`, an explicit semver
  (`0.2.0`), or `none` to publish the version already in `package.json`
  (use `none` for the very first publish, since the file already says
  `0.1.0`).
- **tag** — npm dist-tag. Defaults to `latest`. Use `next` / `beta` for
  pre-releases.

The workflow runs `pnpm typecheck`, bumps + commits + tags (unless `bump=none`),
and publishes with `--provenance` so each release carries a sigstore attestation
tying it to the workflow run + commit.

**One-time setup** before the first run:

1. Create a granular **Automation** access token at npmjs.com scoped to the
   `@screenplay.space` org with publish access for this package.
2. Add it to the repo as a secret named `NPM_TOKEN`
   (Settings → Secrets and variables → Actions).
3. Settings → Actions → General → Workflow permissions: select **Read and
   write permissions** so the bump commit can be pushed back to `main`.

## License

MIT
