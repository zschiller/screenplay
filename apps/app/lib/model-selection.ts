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

/**
 * How a model reads in a picker: its agent (the provider or Harness) and the
 * model, e.g. "Claude Code · Opus 4.8". A Harness with no model list is a
 * single entry labelled with the Harness's own name, so it isn't doubled.
 */
export function modelDisplayLabel(model: ModelInfo): string {
  if (model.label === model.provider.label) return model.label
  return `${model.provider.label} · ${model.label}`
}
