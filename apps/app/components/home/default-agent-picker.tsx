"use client"

import { useEffect, useMemo, useState } from "react"
import { CaretDownIcon, CheckIcon } from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  getDefaultModelId,
  getModels,
  type ModelInfo,
} from "@/lib/models-store"
import {
  groupModelsByProvider,
  modelDisplayLabel,
  resolveDefaultModel,
} from "@/lib/model-selection"
import { useDefaultModel, writeDefaultModel } from "@/lib/default-model-store"

/**
 * The "Default agent" control in Settings: the agent and model new chats and
 * new Workspaces start from. Lists the same catalog as the composer's model
 * picker, and sits on whatever a new chat would pick today until the user
 * chooses, so it never shows a default that isn't the real one.
 */
export function DefaultAgentPicker({ label }: { label: string }) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [serverDefault, setServerDefault] = useState<string | null>(null)
  const userDefault = useDefaultModel()

  useEffect(() => {
    let cancelled = false
    Promise.all([getModels(), getDefaultModelId()])
      .then(([list, def]) => {
        if (cancelled) return
        setModels(list)
        setServerDefault(def)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const current = resolveDefaultModel({
    stored: userDefault,
    serverDefault,
    models,
  })
  const currentModel = models.find((m) => m.id === current)
  const groups = useMemo(() => groupModelsByProvider(models), [models])

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm">{label}</span>
      {loaded && models.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No coding agent installed yet.
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!loaded}
              aria-label={label}
              className="w-60 justify-between font-normal"
            >
              <span className="truncate">
                {currentModel ? modelDisplayLabel(currentModel) : "Loading…"}
              </span>
              <CaretDownIcon className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {groups.map((group, idx) => (
              <div key={group.key}>
                {idx > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.models.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => writeDefaultModel(m.id)}
                  >
                    <span className="flex-1">{m.label}</span>
                    {m.id === current && <CheckIcon className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
