# Sample capture set

Six of the harness's named screens in light and dark, plus one recorded
interaction — evidence that the three commands work end to end, not an input to
anything. Nothing reads this directory.

| File                              | Command                                         |
| --------------------------------- | ----------------------------------------------- |
| `home-recents.<theme>.webp`       | `pnpm screenshots:shots --screens home-recents` |
| `home-table-view.<theme>.webp`    | `--screens home-table-view`                     |
| `canvas.<theme>.webp`             | `--screens canvas`                              |
| `canvas-agent-chat.<theme>.webp`  | `--screens canvas-agent-chat`                   |
| `canvas-plan-review.<theme>.webp` | `--screens canvas-plan-review`                  |
| `settings.<theme>.webp`           | `--screens settings`                            |
| `open-canvas.light.webm`          | `pnpm screenshots:video open-canvas`            |

A real capture run writes **PNGs at 2× device scale** to
`apps/app/.screenshots/captures/<label>/` — that's what you attach to a PR.
These are downscaled to 1× and re-encoded as WebP purely so a dozen images can
live in git; don't copy that step into a review.

Everything here is the fixture world (`../fixtures/world.ts`): the Canvases,
Workspaces, agent turn, and Project presets are invented, and the pages inside
the frames are flat wireframes served by the harness's own preview server. None
of it is a real product screen.
