import "server-only"

import type { Harness, HarnessModel } from "./types"

/**
 * The Harness **model catalog** (issue #527, parent #522): resolves the model
 * list the desktop dropdown shows for a Harness from its **curated floor** plus a
 * **discover-once-and-cached** live augment. It mirrors the model-provider
 * `discover()` cache (`lib/agent/providers/cache.ts`) and the desktop resolver's
 * once-per-launch memoization (`createDesktopResolver`): the discovery runs at
 * most once per app launch, a second `list()` reuses it (no re-probe), and an
 * unreachable/empty source degrades to the curated floor. That gives the catalog
 * the same staleness contract as `hostBinary` Harness detection — a model added
 * to a subscription shows up after a restart, never via a mid-session re-probe.
 *
 * Spike #523 inverted the original "discover live `availableModels` as the
 * source" framing: `enumerateModels` is stateless and can't open a session, and
 * even when read the advertised set under-delivers (claude-code advertises 3
 * buckets, codex advertises none) — all ⊆ a sensible curated set. So the **curated
 * floor is authoritative** and **discovery is additive**: a discovered modelId
 * only ever appends a row the curated floor doesn't already name. Today the
 * production discovery is the deferred session-open augment and advertises
 * nothing (see {@link emptyDiscovery}), so the dropdown is identical to the
 * static-list slice (#525) until that augment lands (story #9, #526).
 */

/**
 * Live model discovery: the advertised `availableModels` ids per harness key, as
 * an ACP session exposes them. Injected so tests can drive the
 * discover-once-and-cache contract without a live session; a rejection is treated
 * as "unreachable" and falls back to the curated floor.
 */
export type HarnessModelDiscovery = () => Promise<Map<string, string[]>>

/**
 * The production discovery: advertises nothing. The dropdown path
 * (`enumerateModels`) is stateless and cannot open a session, and the spike found
 * nothing advertised today exceeds the curated floor — so the live augment is the
 * deferred session-open seam (#526), and until it lands the catalog returns
 * exactly each Harness's curated floor (the dropdown is unchanged from #525).
 */
const emptyDiscovery: HarnessModelDiscovery = async () => new Map()

/**
 * Merge a Harness's **curated floor** (authoritative — its order and human labels
 * are kept) with any **live-advertised** modelId not already curated (additive —
 * appended in advertised order, labeled by its raw id since discovery carries no
 * label). Curated wins on id collisions, so a discovered alias never reorders or
 * relabels a curated entry. Pure.
 */
export function mergeHarnessModels(
  curated: HarnessModel[],
  advertised: string[]
): HarnessModel[] {
  const curatedIds = new Set(curated.map((m) => m.id))
  const extras = advertised
    .filter((id) => !curatedIds.has(id))
    .map((id) => ({ id, label: id }))
  return [...curated, ...extras]
}

/** The catalog seam: a Harness → its dropdown model list (curated floor + augment). */
export interface HarnessModelCatalog {
  list(harness: Harness): Promise<HarnessModel[]>
}

/**
 * Build a catalog over an injected discovery. The discovery promise is memoized
 * the first time any `list()` is called, so every `list()` in the same launch
 * shares one probe (and one fallback on failure) — discover-once-and-cache. A
 * rejected discovery is caught once and degrades every harness this launch to its
 * curated floor; an empty/missing advertised list for a harness does the same.
 * `discover` defaults to {@link emptyDiscovery}; tests pass a fake.
 */
export function createHarnessModelCatalog(
  opts: { discover?: HarnessModelDiscovery } = {}
): HarnessModelCatalog {
  const discover = opts.discover ?? emptyDiscovery
  let discovered: Promise<Map<string, string[]>> | undefined
  return {
    async list(harness) {
      discovered ??= discover().catch((err) => {
        // Unreachable upstream ⇒ curated fallback for every harness this launch.
        console.error("Harness model discovery failed:", err)
        return new Map<string, string[]>()
      })
      const advertised = (await discovered).get(harness.key) ?? []
      return mergeHarnessModels(harness.models ?? [], advertised)
    },
  }
}

/**
 * The configured catalog singleton the dropdown enumeration reads. Its discovery
 * is the deferred session-open augment (empty today), so it returns each Harness's
 * curated floor — see the module note above.
 */
export const harnessModelCatalog: HarnessModelCatalog =
  createHarnessModelCatalog()
