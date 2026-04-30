# @screenplay.space/knobs

Declare interactive controls (sliders, switches, selects, color pickers, text inputs) from a prototype's own code. They show up in a popover on the screenplay canvas next to the artboard's "interact" button. Knob state syncs across viewers in real time.

The package is dev-only by design. In any build with `NODE_ENV` set to anything other than `"development"`, `useKnob` quietly returns the declared `default` and every postMessage path is dead-code-eliminated by the bundler — no listener is attached, no declaration is published, no value is ever read or written from a parent frame. So shipping knobs in committed code is safe: even if the deployed prototype is iframed by some non-screenplay parent in production, none of the knob protocol is wired up to act on.

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
