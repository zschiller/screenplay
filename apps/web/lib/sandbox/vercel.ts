import "server-only"

import { Sandbox, type NetworkPolicy } from "@vercel/sandbox"
import type {
  SandboxCreateOptions,
  SandboxGetOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// Vercel Sandbox's fixed filesystem layout. The repo is cloned into the
// working directory `/vercel/sandbox`, and commands run with `HOME=/root`
// (per Vercel's system specifications). These are the concrete values behind
// the `worktreePath` / `homeDir` seams every other provider would supply for
// itself — the SDK object doesn't carry them, so the adapter attaches them.
const VERCEL_WORKTREE_PATH = "/vercel/sandbox"
const VERCEL_HOME_DIR = "/root"

/**
 * The SDK `Sandbox` structurally satisfies most of {@link SandboxInstance} but
 * carries neither `worktreePath` nor `homeDir` — those are our path seams, not
 * the SDK's concept. Attach the Vercel-fixed values in place (preserving the
 * instance's prototype methods and `this` binding) and surface it as the
 * portable interface.
 */
function adaptVercelSandbox(sandbox: Sandbox): SandboxInstance {
  return Object.assign(sandbox, {
    worktreePath: VERCEL_WORKTREE_PATH,
    homeDir: VERCEL_HOME_DIR,
  }) as unknown as SandboxInstance
}

/**
 * Vercel Sandbox implementation of {@link SandboxProvider}. A thin adapter over
 * `@vercel/sandbox`'s static `Sandbox.create` / `Sandbox.get` — the SDK already
 * returns instances that structurally satisfy most of {@link SandboxInstance};
 * {@link adaptVercelSandbox} only attaches the provider-supplied path seams.
 *
 * Auth: `@vercel/sandbox` authenticates via the OIDC token Vercel injects
 * automatically in production (and that `vercel env pull` writes to
 * `.env.local` for local dev). No constructor arg is needed.
 */
class VercelSandboxProvider implements SandboxProvider {
  async create(opts: SandboxCreateOptions): Promise<SandboxInstance> {
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
