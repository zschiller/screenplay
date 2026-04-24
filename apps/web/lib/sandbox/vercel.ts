import "server-only"

import { Sandbox, type NetworkPolicy } from "@vercel/sandbox"
import type {
  SandboxCreateOptions,
  SandboxGetOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

/**
 * Vercel Sandbox implementation of {@link SandboxProvider}. A thin pass-through
 * around `@vercel/sandbox`'s static `Sandbox.create` / `Sandbox.get` — the SDK
 * already returns instances that structurally satisfy {@link SandboxInstance},
 * so no per-method adapter is needed.
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
    return Sandbox.create({
      ...opts,
      networkPolicy: opts.networkPolicy as NetworkPolicy | undefined,
    } as Parameters<typeof Sandbox.create>[0])
  }

  async get(opts: SandboxGetOptions): Promise<SandboxInstance> {
    return Sandbox.get(opts as Parameters<typeof Sandbox.get>[0])
  }
}

let cached: VercelSandboxProvider | null = null
export function getVercelSandboxProvider(): SandboxProvider {
  if (!cached) cached = new VercelSandboxProvider()
  return cached
}
