# Vercel Sandbox image

The image every hosted chat’s Vercel Sandbox boots from: Vercel’s Ubuntu Sandbox image plus the browser stack shared frames need (`install-browser-stack.sh`: Google Chrome, Xvfb, ffmpeg, xautomation, fonts). The app creates Sandboxes from `screenplay-workspace` in the app project’s Vercel Container Registry; `VERCEL_SANDBOX_IMAGE` overrides it (`apps/app/lib/sandbox/vercel.ts`).

| File | What it does |
| --- | --- |
| `Dockerfile` | Installs the browser stack on the Vercel base, then switches back to user `ubuntu` with `HOME=/vercel` and the worktree at `/vercel/sandbox`. Sandboxes don’t run `ENTRYPOINT` or `CMD`. |
| `docker-bake.hcl` | Builds Vercel’s `ubuntu` and `universal` images from their open Dockerfiles ([vercel/sandbox](https://github.com/vercel/sandbox) `images/`), then this image on top. |
| `install-browser-stack.sh` | The apt and Chrome installs, run as root. |

## How it ships

`.github/workflows/vercel-sandbox-image.yml` builds and pushes on every change to this folder on `main`, weekly (so base and Chrome security updates reach new Sandboxes) and by hand. It signs in to VCR with GitHub OIDC, so it stores no secret. It needs a Vercel OIDC policy for the repository and workflow, and the repository variables `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG` and `SCREENPLAY_APP_VERCEL_PROJECT_SLUG`; until they’re set, the job is skipped.

The base is built from source because the managed `vcr.vercel.com/vercel/sandbox/universal` can’t be pulled as a base outside a Sandbox.

## Building where the registry is blocked

The workflow is the normal route. When you have to build by hand from a cloud container, two things get in the way: the container’s egress proxy blocks `vcr.vercel.com`, and local BuildKit can’t pull from Docker Hub through the proxy’s CA. Build inside a Vercel Sandbox instead:

1. Create a Sandbox and install buildah there (`sudo apt-get install buildah`).
2. Build the base from vercel/sandbox `images/`: `ubuntu` first, then `universal` with `--build-context base=container-image://localhost/<ubuntu tag>`. Prefix Docker Hub images with `docker.io/` (for example `docker.io/oven/bun`); buildah doesn’t assume it.
3. Build this `Dockerfile` with `--build-arg BASE_IMAGE=<universal tag>`.
4. Log in with `-u oidc` and a `VERCEL_OIDC_TOKEN` as the password, and push to `vcr.vercel.com/<team slug>/<app project slug>/screenplay-workspace`.

That OIDC token can push to the project’s repository but gets a 404 pulling Vercel’s managed images, which is another reason the base is built from source.

## Native popups need xautomation

A viewer’s mouse on a shared frame reaches the frame’s Chrome as real X input through `xte` (from xautomation), because CDP’s input can’t open native popups: a `<select>`’s list, date and colour pickers, context menus. `apps/app/lib/sandbox-bridge/frame-stream.mjs` finds `xte` at `/usr/bin/xte` or `/usr/local/bin/xte` and falls back to CDP without it. `SCREENPLAY_XTE` overrides the path; an empty value turns it off. Keep xautomation in `install-browser-stack.sh`, which fails the build if `xte` is missing.
