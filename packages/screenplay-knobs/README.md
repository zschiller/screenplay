# @screenplay.space/knobs

Declare interactive controls (sliders, switches, selects, color pickers, text inputs) from a prototype's own code. They show up in the frame’s Knobs popover on the Screenplay canvas and in play mode’s knobs panel. Knob state syncs across viewers in real time.

The package is dev-only by design. In any build with `NODE_ENV` set to anything other than `"development"`, `useKnob` quietly returns the declared `default` and no postMessage path ever runs — no listener is attached, no declaration is published, no value is ever read or written from a parent frame. So shipping knobs in committed code is safe: even if the deployed prototype is iframed by some non-screenplay parent in production, none of the knob protocol is wired up to act on.

## Install

```bash
npm install --save @screenplay.space/knobs
```

`react >= 17` is a peer dependency.

## Bundler support

Activation only needs your bundler to inline `process.env.NODE_ENV` inside dependencies, which Vite, Next, webpack, Rspack, Parcel and plain esbuild all do. **Vite works out of the box** — no `globalThis.process` shim in `index.html`, no `define` entry. (Earlier releases also required a global `process` object, which Vite doesn't provide, so the package stayed inert there.)

Loaded straight into a browser as ESM with no bundler at all, nothing inlines `NODE_ENV`; the package then stays inert rather than throwing, and `useKnob` returns the declared `default`.

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
| `tabs`    | Tabs           | `default` (string); 2–3 short `options: { value, label? }[]` |
| `color`   | Color picker   | `default` (string, e.g. `"#1d4ed8"`)                 |

All knobs accept an optional `label` (defaults to the `id`), an optional `description` (a short phrase shown in a tooltip on the label's info icon), an optional `group` (knobs with the same group sit under one heading) and an optional `validator: (v) => v` that runs locally inside the prototype on every incoming value — use it to clamp or sanitize before exposing the value to your component.

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
  (`0.2.0`), or `none` to publish the version already in `package.json`.
- **tag** — npm dist-tag. Defaults to `latest`. Use `next` / `beta` for
  pre-releases.

The workflow runs `pnpm typecheck`, publishes via npm **Trusted Publishing**
(OIDC — no `NPM_TOKEN` secret), drops a git tag like
`screenplay-knobs-v0.1.1`, and opens a PR to merge the version bump into
`main`. Merging the PR is one click. Each release also carries a sigstore
provenance attestation tying it to the workflow run.

The PR-based bump works around `main` branch protection — the workflow never
needs to push directly to a protected branch.

**One-time setup** before the first run:

1. **Configure Trusted Publishing on npm.** Sign in to npmjs.com → org
   `@screenplay.space` → Trusted Publishers → **Add Trusted Publisher** with:
   - **Package**: `@screenplay.space/knobs`
   - **Publisher**: GitHub Actions
   - **Repository owner**: `zschiller`
   - **Repository**: `screenplay`
   - **Workflow filename**: `publish-knobs.yml`
   - **Environment name**: *(leave blank)*

2. **Allow Actions to push branches and open PRs.** GitHub repo Settings →
   Actions → General → Workflow permissions: select **Read and write
   permissions**. The workflow only ever pushes to `release/*` branches +
   tags — never directly to `main` — so this is compatible with branch
   protection rules requiring PRs on `main`.

## License

MIT
