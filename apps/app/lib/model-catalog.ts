import type { ModelInfo, ModelsResponse } from "@/lib/models-store"
import type { SkillMenuItem } from "@/lib/skills-store"
import { resolveDefaultModel } from "@/lib/model-selection"

/**
 * The model and skill catalog behind every Composer and model picker: the
 * Workspace chat, the New chat dialog and the Settings default-agent picker all
 * read this one module instead of each fetching, retrying and resolving the
 * default on their own.
 *
 * It owns the model fetch (once per app, cached on success, retried on
 * demand), whether that fetch is loading, loaded or failed, default-model
 * resolution, and the `/`-Skill index. Where the data comes from is a
 * {@link CatalogSource}: the HTTP routes in the app (`lib/use-model-catalog`),
 * an in-memory one ({@link inMemoryCatalogSource}) in tests.
 */

/** Where the catalog's data comes from. */
export interface CatalogSource {
  /** The models this deployment can run and its suggested default. */
  loadModels(): Promise<ModelsResponse>
  /**
   * The `/`-Skill index for a Sandbox's Branch (App ∪ Repo), or App Skills
   * only with no Sandbox.
   */
  loadSkills(sandboxName?: string): Promise<SkillMenuItem[]>
}

/**
 * `idle` before the first load, `loading` while a fetch is in flight, then
 * `loaded` or `failed`. Only `loaded` can say the list is empty: a failed
 * fetch is not "no coding agent".
 */
export type CatalogStatus = "idle" | "loading" | "loaded" | "failed"

export interface CatalogState {
  status: CatalogStatus
  /** The loaded models. Empty until loaded. */
  models: ModelInfo[]
  /** The server's suggested default, null until loaded or with no provider. */
  serverDefault: string | null
}

export interface ModelCatalog {
  /** Fetch the models unless they're loaded or already loading. */
  load(): void
  /** Fetch again after a failure. */
  retry(): void
  getState(): CatalogState
  subscribe(onChange: () => void): () => void
  /** The Skill index for `sandboxName`; concurrent calls share one fetch. */
  loadSkills(sandboxName?: string): Promise<SkillMenuItem[]>
}

const IDLE: CatalogState = { status: "idle", models: [], serverDefault: null }

export function createModelCatalog(source: CatalogSource): ModelCatalog {
  let state = IDLE
  const listeners = new Set<() => void>()
  const set = (next: CatalogState) => {
    state = next
    for (const listener of listeners) listener()
  }

  const fetchModels = () => {
    set({ ...state, status: "loading" })
    source.loadModels().then(
      ({ models, defaultModelId }) =>
        set({ status: "loaded", models, serverDefault: defaultModelId }),
      () => set({ ...state, status: "failed" })
    )
  }

  // The Skill index is Branch-specific (a Branch's Repo Skills change as the
  // agent edits its tree), so it isn't cached: each Composer fetches on open,
  // and only concurrent requests for one Sandbox share a fetch.
  const pendingSkills = new Map<string, Promise<SkillMenuItem[]>>()

  return {
    load() {
      if (state.status === "idle" || state.status === "failed") fetchModels()
    },
    retry() {
      if (state.status === "failed") fetchModels()
    },
    getState: () => state,
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    loadSkills(sandboxName) {
      const key = sandboxName ?? ""
      let inflight = pendingSkills.get(key)
      if (!inflight) {
        inflight = source.loadSkills(sandboxName).finally(() => {
          pendingSkills.delete(key)
        })
        pendingSkills.set(key, inflight)
      }
      return inflight
    },
  }
}

export interface ResolvedModels {
  /** The model the picker sits on: the chosen one if still valid. */
  model: string
  /** The model new chats start from: the user's, else the server's. */
  defaultModel: string
  /** Loaded with nothing in it: no coding agent / provider is set up. */
  noAgents: boolean
}

/**
 * Resolve a picker's model from the catalog, by precedence: the chosen model
 * (a chat's or row's own pick) → the user's default from Settings → the
 * server default → the first model. See {@link resolveDefaultModel}.
 */
export function resolveModels(
  state: CatalogState,
  { chosen, stored }: { chosen?: string | null; stored?: string | null }
): ResolvedModels {
  const { models, serverDefault } = state
  return {
    model: resolveDefaultModel({
      perSession: chosen || null,
      stored,
      serverDefault,
      models,
    }),
    defaultModel: resolveDefaultModel({ stored, serverDefault, models }),
    noAgents: state.status === "loaded" && models.length === 0,
  }
}

/**
 * A {@link CatalogSource} over fixed data, for tests. The first `failures`
 * model fetches reject; `skills` is keyed by Sandbox name ("" for none).
 */
export function inMemoryCatalogSource({
  models = [],
  defaultModelId = null,
  skills = {},
  failures = 0,
}: {
  models?: ModelInfo[]
  defaultModelId?: string | null
  skills?: Record<string, SkillMenuItem[]>
  failures?: number
} = {}): CatalogSource & { modelLoads: number } {
  const source = {
    modelLoads: 0,
    loadModels() {
      source.modelLoads += 1
      return source.modelLoads <= failures
        ? Promise.reject(new Error("models unavailable"))
        : Promise.resolve({ models, defaultModelId })
    },
    loadSkills(sandboxName?: string) {
      return Promise.resolve(skills[sandboxName ?? ""] ?? [])
    },
  }
  return source
}
