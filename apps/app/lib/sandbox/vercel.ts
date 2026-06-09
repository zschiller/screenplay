import "server-only"

import { Sandbox, type NetworkPolicy } from "@vercel/sandbox"
import type {
  HibernatingSandbox,
  SandboxCreateOptions,
  SandboxGetOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// Vercel Sandbox's fixed filesystem layout. The repo is cloned into the
// working directory `/vercel/sandbox`, and ordinary (non-`sudo`) commands run as
// the unprivileged `vercel-sandbox` user, whose home is `/home/vercel-sandbox`
// (only `sudo` commands run as root with `HOME=/root`, and that user has no
// access to `/root`). The terminal's tmux login shell — where the user actually
// runs `claude` — is one of those unprivileged shells, so the writable home that
// user-level config must be seeded into is `/home/vercel-sandbox`, NOT `/root`.
// Seeding under `/root` silently fails (no write permission) and is unreadable
// by the shell anyway, which is what regressed the pre-seeded onboarding (#267).
// These are the concrete values behind the `worktreePath` / `homeDir` seams
// every other provider would supply for itself — the SDK object doesn't carry
// them, so the adapter attaches them.
const VERCEL_WORKTREE_PATH = "/vercel/sandbox"
const VERCEL_HOME_DIR = "/home/vercel-sandbox"

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
    worktreePath: VERCEL_WORKTREE_PATH,
    homeDir: VERCEL_HOME_DIR,
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
      // local worktree backend can honor a local-path source (PRD #428).
      throw new Error(
        "VercelSandboxProvider: a local-path repo source requires the worktree backend"
      )
    }
    // The SDK's create/get param types intersect with a `Credentials` shape
    // (token, projectId, teamId). At runtime those come from VERCEL_OIDC_TOKEN
    // in the environment — no need to pass them — but the types treat them as
    // required on the input, so we loosen here rather than at every call site.
    const sandbox = await Sandbox.create({
      ...opts,
      networkPolicy: opts.networkPolicy as NetworkPolicy | undefined,
    } as Parameters<typeof Sandbox.create>[0])
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
