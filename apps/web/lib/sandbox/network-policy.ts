import type { ModelProvider } from "@/lib/agent/providers"
import type { SandboxNetworkPolicy } from "@/lib/sandbox/types"

/**
 * Derive the sandbox network policy from the model-provider registry.
 *
 * For each provider that exposes an egress descriptor (it's configured and its
 * auth is header-brokerable), emit an allow rule for its host whose transform
 * injects the provider's auth header. The Vercel firewall applies
 * `transform.headers` as an **overwrite** (not append), so a harness's own
 * dummy/empty auth header is replaced by the injected real one — the sandbox
 * never sees the real key. The catch-all `"*": []` lets every other host pass
 * through end-to-end unchanged.
 *
 * Pure: a fold over the passed providers with no sandbox or I/O dependency, so
 * adding a provider to the registry extends egress coverage for free and the
 * whole policy is unit-testable.
 */
export function buildNetworkPolicy(
  providers: ModelProvider[],
): SandboxNetworkPolicy {
  const allow: SandboxNetworkPolicy["allow"] = { "*": [] }
  for (const provider of providers) {
    const egress = provider.egress()
    if (!egress) continue
    allow[egress.host] = [{ transform: [{ headers: egress.headers }] }]
  }
  return { allow }
}
