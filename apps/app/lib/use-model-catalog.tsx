"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  createModelCatalog,
  resolveModels,
  type CatalogSource,
  type CatalogStatus,
  type ModelCatalog,
  type ResolvedModels,
} from "@/lib/model-catalog"
import { fetchModelCatalog, type ModelInfo } from "@/lib/models-store"
import {
  getSkillMenuItems,
  skillSourceKey,
  type SkillMenuItem,
  type SkillSource,
} from "@/lib/skills-store"
import { useDefaultModel } from "@/lib/default-model-store"
import {
  expandHarnessModelChoices,
  useHarnessModelChoices,
} from "@/lib/harness-model-choices"

/** The app's catalog, over the `/api/agent/models` and `/skills` routes. */
export const httpCatalogSource: CatalogSource = {
  loadModels: fetchModelCatalog,
  loadSkills: getSkillMenuItems,
}

const appCatalog = createModelCatalog(httpCatalogSource)

const CatalogContext = createContext<ModelCatalog>(appCatalog)

/** Swap the catalog under a subtree — tests pass an in-memory one. */
export function ModelCatalogProvider({
  catalog,
  children,
}: {
  catalog: ModelCatalog
  children: ReactNode
}) {
  return (
    <CatalogContext.Provider value={catalog}>
      {children}
    </CatalogContext.Provider>
  )
}

export interface ModelCatalogView extends ResolvedModels {
  status: CatalogStatus
  models: ModelInfo[]
  retry: () => void
}

/**
 * The model catalog, loaded on first use, with `chosen` (a chat's or row's own
 * pick, if any) resolved against it and the user's default from Settings.
 */
export function useModelCatalog(chosen?: string | null): ModelCatalogView {
  const catalog = useContext(CatalogContext)
  const state = useSyncExternalStore(
    catalog.subscribe,
    catalog.getState,
    catalog.getState
  )
  // Live, so a change in Settings reaches an open chat still on the default.
  const stored = useDefaultModel()
  // The models chosen in Settings for OpenCode stand in for its one entry.
  const choices = useHarnessModelChoices()
  const models = useMemo(
    () => expandHarnessModelChoices(state.models, choices),
    [state.models, choices]
  )
  useEffect(() => catalog.load(), [catalog])
  return {
    ...resolveModels({ ...state, models }, { chosen, stored }),
    status: state.status,
    models,
    retry: catalog.retry,
  }
}

export type { SkillSource }

/**
 * The `/`-Skill index for `source`, fetched when the Composer opens and again
 * when it's re-pointed at another Sandbox or canvas. No source, no fetch.
 */
export function useSkillIndex(source: SkillSource | undefined): {
  skills: SkillMenuItem[]
  loading: boolean
} {
  const catalog = useContext(CatalogContext)
  const key = source ? skillSourceKey(source) : null
  const sandboxName = source?.sandboxName
  const roomId = source?.roomId
  const chat = source?.chat
  const model = source?.model
  const [index, setIndex] = useState<{
    key: string | null
    skills: SkillMenuItem[]
  }>({ key: null, skills: [] })

  useEffect(() => {
    if (key === null) return undefined
    let cancelled = false
    catalog
      .loadSkills({ sandboxName, roomId, chat, model })
      .catch(() => [] as SkillMenuItem[])
      .then((skills) => {
        if (!cancelled) setIndex({ key, skills })
      })
    return () => {
      cancelled = true
    }
  }, [catalog, key, sandboxName, roomId, chat, model])

  // A result for another Sandbox is stale: loading until this one lands.
  const current = index.key === key
  return { skills: current ? index.skills : [], loading: !current }
}
