import "server-only"

import { Sandbox, type NetworkPolicy } from "@vercel/sandbox"
import type {
  HibernatingSandbox,
  SandboxCreateOptions,
  SandboxGetOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// The image every hosted Workspace Sandbox boots from: Vercel's Ubuntu image
// plus the browser stack shared frames need (`apps/app/vercel-sandbox-image/`, pushed
// to the project's Vercel Container Registry by `vercel-sandbox-image.yml`). A bare
// repository name resolves against the authenticated project.
export const VERCEL_SANDBOX_IMAGE_ENV_VAR = "VERCEL_SANDBOX_IMAGE"
export const DEFAULT_SANDBOX_IMAGE = "screenplay-workspace"

/**
 * A Sandbox's fixed filesystem layout: where the repo is checked out (also the
 * default cwd of every command) and the writable home of the unprivileged user
 * ordinary (non-`sudo`) commands run as. `sudo` commands run as root with
 * `HOME=/root`, which that user can't read. The terminal's tmux login shell —
 * where the user actually runs `claude` — is one of those unprivileged shells,
 * so user-level config must be seeded into this home, never `/root`. Seeding
 * under `/root` silently fails and is unreadable by the shell anyway, which is
 * what regressed the pre-seeded onboarding (#267).
 *
 * The SDK object doesn't carry these, so the adapter attaches them as the
 * `worktreePath` / `homeDir` seams every other provider supplies for itself.
 */
type VercelLayout = { worktreePath: string; homeDir: string }

// Image-backed Sandboxes (#1388): the `ubuntu` user with `HOME=/vercel`. The
// image's WORKDIR is the worktree, and `liftCheckout` moves the clone there.
export const IMAGE_LAYOUT: VercelLayout = {
  worktreePath: "/vercel/sandbox",
  homeDir: "/vercel",
}

// Sandboxes created before #1388 on the legacy `node24` runtime, which resume
// from their snapshots with this layout: the `vercel-sandbox` user, cloned
// into its default cwd.
export const LEGACY_RUNTIME_LAYOUT: VercelLayout = {
  worktreePath: "/vercel/sandbox",
  homeDir: "/home/vercel-sandbox",
}

/** The layout a Sandbox was created with: an image, or the legacy runtime. */
export function vercelLayout(sandbox: { image?: string }): VercelLayout {
  return sandbox.image ? IMAGE_LAYOUT : LEGACY_RUNTIME_LAYOUT
}

/** The image new Sandboxes boot from: `VERCEL_SANDBOX_IMAGE`, else our own repository. */
export function sandboxImage(): string {
  return (
    process.env[VERCEL_SANDBOX_IMAGE_ENV_VAR]?.trim() || DEFAULT_SANDBOX_IMAGE
  )
}

// An image-backed Sandbox clones a git source into a directory named after the
// repo inside the image's WORKDIR, not into the WORKDIR itself. Move the clone
// to the fixed worktree path the rest of the app (and the default cwd) expects.
// A no-op when the checkout is already there. Run from `/vercel` so the moved
// directory is never the shell's own cwd.
export const LIFT_CHECKOUT_SCRIPT = [
  "set -e",
  `W=${IMAGE_LAYOUT.worktreePath}`,
  '[ -d "$W/.git" ] && exit 0',
  "src=",
  'for d in "$W"/*/ /vercel/*/; do if [ -d "${d}.git" ]; then src="${d%/}"; break; fi; done',
  '[ -n "$src" ] || { echo "no git checkout found under /vercel" >&2; exit 1; }',
  'mv "$src" /vercel/.screenplay-checkout',
  'if [ -e "$W" ]; then rmdir "$W"; fi',
  'mv /vercel/.screenplay-checkout "$W"',
].join("\n")

async function liftCheckout(sandbox: Sandbox): Promise<void> {
  const res = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", LIFT_CHECKOUT_SCRIPT],
    cwd: "/vercel",
  })
  if (res.exitCode !== 0) {
    throw new Error(
      `VercelSandboxProvider: couldn't move the checkout to ${IMAGE_LAYOUT.worktreePath}: ${(await res.stderr()).slice(0, 500)}`
    )
  }
}

/**
 * Adapts an `@vercel/sandbox` `Sandbox` to {@link HibernatingSandbox}. The SDK
 * `Sandbox` structurally satisfies most of the core {@link SandboxInstance} but
 * carries neither the `worktreePath` / `homeDir` path seams (our concept, not
 * the SDK's) nor the hibernation capability's `isRunning()` predicate. Attach
 * all three in place — preserving the instance's prototype methods and `this`
 * binding — so the returned object both supplies the portable path values and
 * advertises hibernation through {@link supportsHibernation}. Vercel Sandbox is
 * a full hibernating backend: snapshot/restore, resume of a stopped VM, and the
 * auto-stop timeout all map straight through the SDK.
 */
function adaptVercelSandbox(sandbox: Sandbox): HibernatingSandbox {
  return Object.assign(sandbox, {
    ...vercelLayout(sandbox),
    // Each VM owns its network namespace, so a logical forwarded port IS the
    // bound port — the hostPort seam is the identity here. (This is also what
    // keeps one Repo config portable: `$SCREENPLAY_PORT` resolves to the
    // configured Dev Server Port itself on this backend.)
    hostPort: (port: number) => port,
    isRunning: () => sandbox.status === "running",
  }) as unknown as HibernatingSandbox
}

/**
 * Vercel Sandbox implementation of {@link SandboxProvider}. A thin adapter over
 * `@vercel/sandbox`'s static `Sandbox.create` / `Sandbox.get` — the SDK already
 * returns instances that structurally satisfy most of {@link SandboxInstance};
 * {@link adaptVercelSandbox} attaches the provider-supplied path seams and the
 * hibernation capability.
 *
 * Auth: `@vercel/sandbox` authenticates via the OIDC token Vercel injects
 * automatically in production (and that `vercel env pull` writes to
 * `.env.local` for local dev). No constructor arg is needed.
 */
class VercelSandboxProvider implements SandboxProvider {
  async create(opts: SandboxCreateOptions): Promise<SandboxInstance> {
    if (opts.source.type === "local-git") {
      // A remote VM has no host filesystem to root a checkout in; only the
      // local backend can honor a local-path source (PRD #428).
      throw new Error(
        "VercelSandboxProvider: a local-path repo source requires the local backend"
      )
    }
    // The SDK's create/get param types intersect with a `Credentials` shape
    // (token, projectId, teamId). At runtime those come from VERCEL_OIDC_TOKEN
    // in the environment — no need to pass them — but the types treat them as
    // required on the input, so we loosen here rather than at every call site.
    //
    //
    // A fresh Sandbox boots from our image (see `sandboxImage`). A snapshot
    // restore takes no image: it boots from the snapshot, which keeps the image
    // (or legacy runtime) it was taken from, and `vercelLayout` reads which.
    const fromSnapshot = opts.source.type === "snapshot"
    const image = fromSnapshot ? undefined : sandboxImage()
    let sandbox: Sandbox
    try {
      sandbox = await Sandbox.create({
        ...(image ? { image } : {}),
        ...opts,
        networkPolicy: opts.networkPolicy as NetworkPolicy | undefined,
      } as Parameters<typeof Sandbox.create>[0])
    } catch (e) {
      // A missing or still-preparing image is a deploy setup step, not a
      // transient failure: name the image so the operator knows what to push.
      const message = e instanceof Error ? e.message : String(e)
      if (image && /not_found|image_not_ready/.test(message)) {
        throw new Error(
          `Sandbox image "${image}" isn't available in this project's Vercel Container Registry. Build and push apps/app/vercel-sandbox-image (see the Sandbox provider docs). ${message}`
        )
      }
      throw e
    }
    if (!fromSnapshot) {
      try {
        await liftCheckout(sandbox)
      } catch (e) {
        await sandbox.stop().catch(() => {})
        throw e
      }
    }
    return adaptVercelSandbox(sandbox)
  }

  async get(opts: SandboxGetOptions): Promise<SandboxInstance> {
    const sandbox = await Sandbox.get(opts as Parameters<typeof Sandbox.get>[0])
    return adaptVercelSandbox(sandbox)
  }
}

let cached: VercelSandboxProvider | null = null
export function getVercelSandboxProvider(): SandboxProvider {
  if (!cached) cached = new VercelSandboxProvider()
  return cached
}
