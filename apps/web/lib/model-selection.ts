import type { ModelInfo } from "@/lib/models-store"

export interface ModelGroup {
  key: string
  label: string
  models: ModelInfo[]
}

/**
 * Group models by their origin provider (Anthropic, OpenAI, Vercel AI
 * Gateway, …) so the picker can surface them under headings the user can
 * scan. Preserves the registry's order both at the group level (which
 * provider showed up first in `enumerateModels`) and within each group.
 *
 * Pure and UI-agnostic: shared by the chat composer and the parallel-create
 * dialog so the two pickers can never drift apart.
 */
export function groupModelsByProvider(models: ModelInfo[]): ModelGroup[] {
  const order: string[] = []
  const byKey = new Map<string, ModelGroup>()
  for (const m of models) {
    let group = byKey.get(m.provider.key)
    if (!group) {
      group = { key: m.provider.key, label: m.provider.label, models: [] }
      byKey.set(m.provider.key, group)
      order.push(m.provider.key)
    }
    group.models.push(m)
  }
  return order.map((k) => byKey.get(k)!)
}

export interface ResolveModelArgs {
  /**
   * Per-session override — the model explicitly picked for this chat/row.
   * Highest precedence. Omit (or pass null) where there's no per-session
   * concept, e.g. each parallel-create row seeds from the shared default.
   */
  perSession?: string | null
  /** The user's last-used model, read from localStorage. */
  stored?: string | null
  /** Server-suggested default for the configured provider set. */
  serverDefault?: string | null
  /** The loaded catalog. Empty while still fetching. */
  models: ModelInfo[]
}

/**
 * Resolve the model a picker should sit on, by precedence:
 * per-session override → stored last-used → server default → first available.
 *
 * Returns "" while the catalog is still loading (length 0) so callers can
 * render a "Loading…" placeholder rather than a stale id from a different
 * deployment's provider set. Once the catalog has loaded, a preferred id
 * that's no longer in it (e.g. the user's last-used model was retired when a
 * newer one shipped) is dropped — we fall back to the server default, then
 * the first listed model — so the picker never sits on an invalid value.
 */
export function resolveDefaultModel({
  perSession,
  stored,
  serverDefault,
  models,
}: ResolveModelArgs): string {
  const preferred = perSession ?? stored ?? serverDefault ?? ""
  if (models.length === 0 || models.some((m) => m.id === preferred))
    return preferred
  if (serverDefault && models.some((m) => m.id === serverDefault))
    return serverDefault
  return models[0]?.id ?? preferred
}
