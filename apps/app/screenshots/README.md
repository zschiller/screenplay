# Screenshot harness

The scripted path from a fresh container to before/after screenshots on a
design-polish PR (issue #716). Full contributor docs:
[Screenshots for design review](../../docs/content/screenshots.mdx).

```bash
pnpm screenshots:browsers   # once per machine
pnpm screenshots:boot       # seed a fresh world, serve it at :3947
pnpm screenshots:shots      # every named screen, light and dark
pnpm screenshots:video open-canvas
```

## What's here

| Path                         | What it owns                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `profile.ts`                 | The **capture profile** — the local-build env, the state dirs, the ports. The `desktop.env` of a web container. |
| `fixtures/world.ts`          | The **fixture world**, as data. Add the state your ticket needs here.                                           |
| `fixtures/seed.ts`           | The single writer: PGlite rows, `.ydoc` files, blobs.                                                           |
| `fixtures/frame-captures.ts` | Synthetic Frame Captures so the home grid composes real cards.                                                  |
| `screens.ts`                 | The **named screen list**. A new screen is a name, a path, and maybe a `prepare`.                               |
| `interactions.ts`            | The **named interactions** recorded to video.                                                                   |
| `lib/preview-server.ts`      | Serves fixture pages for Iframe Layers, with the real Sandbox Bridge inlined.                                   |
| `lib/capture.ts`             | Runs a capture set; one context per screen-and-theme.                                                           |
| `lib/server.ts`              | Boots (or reuses) the app and the preview server.                                                               |
| `bin/`                       | The four entry points behind the `screenshots:*` package scripts.                                               |
| `sample/`                    | A committed sample capture set — proof the harness works, not an input.                                         |

Runtime state and capture output land in `apps/app/.screenshots/`, which is
gitignored.
