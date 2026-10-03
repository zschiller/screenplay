"use client"

import { useMemo } from "react"
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
import { groupModelsByProvider, modelDisplayLabel } from "@/lib/model-selection"
import { writeDefaultModel } from "@/lib/default-model-store"
import { useModelCatalog } from "@/lib/use-model-catalog"

/**
 * The "Default model" control in Settings: the agent and model new chats and
 * new Workspaces start from. Lists the same catalog as the composer's model
 * picker, and sits on whatever a new chat would pick today until the user
 * chooses, so it never shows a default that isn't the real one.
 */
export function DefaultAgentPicker({ label }: { label: string }) {
  // Sits on what a new chat would pick today: the user's default, else the
  // server's. A list that failed isn't an empty one, so it doesn't read as "No
  // coding agent installed yet".
  const {
    status,
    models,
    defaultModel: current,
    noAgents,
    retry,
  } = useModelCatalog()
  const loaded = status === "loaded"
  const currentModel = models.find((m) => m.id === current)
  const groups = useMemo(() => groupModelsByProvider(models), [models])

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm">{label}</span>
      {status === "failed" ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          Couldn&apos;t load models.
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </span>
      ) : noAgents ? (
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
          <DropdownMenuContent align="start">
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
