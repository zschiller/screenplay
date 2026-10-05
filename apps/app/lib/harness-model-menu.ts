import {
  decodeHarnessModelId,
  encodeHarnessModelId,
} from "@/lib/agent/harnesses/model-id"
import type { HarnessModelChoice } from "@/lib/agent/harnesses/types"
import type { ModelInfo } from "@/lib/models-store"

/**
 * The model menu every picker shows, and the model it sits on (ADR 0011).
 *
 * The server lists each Harness's curated models, or one bare `harness:<key>`
 * entry for a Harness whose CLI reaches too many to curate (OpenCode, #1589).
 * On this device the bare entry gives way to the models chosen for it in
 * Settings › Agent › Choose models. A chat or default whose id has left the
 * menu (a model chosen in place of the bare entry, a model unchecked, a curated
 * model retired) stays on its own Harness: it falls to that Harness's default
 * entry, never to another Harness, which would run the next turn somewhere
 * else and replay the history there.
 *
 * Pure: the store (`lib/harness-model-choices.ts`) and the catalog hook
 * (`lib/use-model-catalog.tsx`) feed it.
 */

/** The models chosen in Settings, by Harness key. */
export type HarnessModelChoices = Record<string, HarnessModelChoice[]>

export interface ModelMenuInput {
  /** The server's catalog: curated entries, a bare one per uncurated Harness. */
  models: ModelInfo[]
  /** This device's chosen models, by Harness key. */
  choices: HarnessModelChoices
  /** The chat's or row's own pick. Highest precedence. */
  chosen?: string | null
  /** The user's default model, set in Settings (`lib/default-model-store`). */
  stored?: string | null
  /** The server's suggested default. */
  serverDefault?: string | null
}

export interface ModelMenu {
  /** What the picker lists. */
  models: ModelInfo[]
  /** The model the picker sits on: the chosen one, kept to its Harness. */
  model: string
  /** The model new chats start from: the user's, else the server's. */
  defaultModel: string
}

export function modelMenu({
  models: catalog,
  choices,
  chosen,
  stored,
  serverDefault,
}: ModelMenuInput): ModelMenu {
  const models = withChoices(catalog, choices)
  return {
    models,
    model: resolveMenuModel(models, {
      preferred: chosen || stored || serverDefault,
      serverDefault,
    }),
    defaultModel: resolveMenuModel(models, {
      preferred: stored || serverDefault,
      serverDefault,
    }),
  }
}

/**
 * Each bare `harness:<key>` entry replaced by the models chosen for it, under
 * the same heading. The first chosen model takes over as the Harness's default.
 * A model name two providers share reads with its provider, so the menu never
 * shows the same label twice. A Harness with nothing chosen keeps its entry.
 */
function withChoices(
  models: ModelInfo[],
  choices: HarnessModelChoices
): ModelInfo[] {
  return models.flatMap((model) => {
    const decoded = decodeHarnessModelId(model.id)
    const chosen =
      decoded && !decoded.modelId ? choices[decoded.key] : undefined
    if (!decoded || !chosen?.length) return [model]
    const counts = new Map<string, number>()
    for (const m of chosen) counts.set(m.label, (counts.get(m.label) ?? 0) + 1)
    return chosen.map((m, i) => ({
      id: encodeHarnessModelId(decoded.key, m.id),
      label: counts.get(m.label)! > 1 ? `${m.label} (${m.group})` : m.label,
      provider: model.provider,
      ...(i === 0 && { isDefault: true as const }),
    }))
  })
}

/**
 * The id a picker sits on. While the catalog is loading (empty) the preferred
 * id is held as-is, so nothing flashes. Once loaded: the preferred id if listed,
 * else its own Harness's default entry, else the server default (or its
 * Harness's default), else the first model.
 */
function resolveMenuModel(
  models: ModelInfo[],
  {
    preferred,
    serverDefault,
  }: { preferred?: string | null; serverDefault?: string | null }
): string {
  const id = preferred ?? ""
  if (models.length === 0 || models.some((m) => m.id === id)) return id
  return (
    sameHarness(models, id) ??
    (serverDefault && models.some((m) => m.id === serverDefault)
      ? serverDefault
      : sameHarness(models, serverDefault)) ??
    models[0]!.id
  )
}

/** The default entry, else the first, of the Harness `id` names. */
function sameHarness(
  models: ModelInfo[],
  id: string | null | undefined
): string | undefined {
  const key = decodeHarnessModelId(id)?.key
  if (!key) return undefined
  const own = models.filter((m) => decodeHarnessModelId(m.id)?.key === key)
  return (own.find((m) => m.isDefault) ?? own[0])?.id
}
