"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  PICKER_DIALOG_CLASS,
  PICKER_DIALOG_HEADER_CLASS,
} from "@/components/picker-dialog"
import { ScrollHairline } from "@/components/scroll-hairline"
import { listHarnessModelChoices } from "@/lib/agent/harnesses/setup-actions"
import type { HarnessModelChoice } from "@/lib/agent/harnesses/types"
import {
  useHarnessModelChoices,
  writeHarnessModelChoices,
} from "@/lib/harness-model-choices"

/**
 * Settings › Agent's Choose models for a Harness whose CLI lists more models
 * than anyone wants in the model menu (OpenCode, #1589). It lists them live,
 * grouped by provider, in the repo picker's frame; each check puts a model in
 * the model menu at once, and closing is all that's left to do.
 */
export function HarnessModelsDialog({
  harnessKey,
  label,
  open,
  onOpenChange,
}: {
  harnessKey: string
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [all, setAll] = useState<HarnessModelChoice[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [listScrolled, setListScrolled] = useState(false)
  const chosen = useHarnessModelChoices()[harnessKey] ?? NONE
  const chosenIds = useMemo(() => new Set(chosen.map((m) => m.id)), [chosen])

  // Listed fresh each time it opens, so a provider signed in since shows up.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listHarnessModelChoices(harnessKey)
      .then((models) => {
        if (cancelled) return
        setLoadFailed(!models)
        if (models) setAll(models)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, harnessKey, attempt])

  const groups = useMemo(() => groupByProvider(all ?? []), [all])

  // Keeps the menu in the list's order, and keeps a chosen model the list no
  // longer has (its provider signed out) until it's unchecked here.
  const toggle = useCallback(
    (model: HarnessModelChoice) => {
      const on = !chosenIds.has(model.id)
      const ids = new Set(chosenIds)
      if (on) ids.add(model.id)
      else ids.delete(model.id)
      const listed = (all ?? []).filter((m) => ids.has(m.id))
      const listedIds = new Set(listed.map((m) => m.id))
      const unlisted = chosen.filter(
        (m) => ids.has(m.id) && !listedIds.has(m.id)
      )
      writeHarnessModelChoices(harnessKey, [...listed, ...unlisted])
    },
    [all, chosen, chosenIds, harnessKey]
  )

  const loading = all === null && !loadFailed

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={PICKER_DIALOG_CLASS}>
        <DialogHeader className={PICKER_DIALOG_HEADER_CLASS}>
          <DialogTitle>{label} models</DialogTitle>
          <DialogDescription>
            {all
              ? `${countIn(chosen, all)} of ${all.length} in the model menu`
              : "The ones you check show in the model menu."}
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput
            placeholder="Search models"
            // Filtering snaps the list back to the top without a scroll event.
            onValueChange={() => setListScrolled(false)}
          />
          <div className="relative min-h-0 flex-1">
            <ScrollHairline shown={listScrolled} />
            <CommandList
              onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
            >
              {all && <CommandEmpty>No models found.</CommandEmpty>}
              {loading && (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-10"
                >
                  <Spinner className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Loading models…
                  </span>
                </div>
              )}
              {loadFailed && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <span className="text-sm text-muted-foreground">
                    {`Couldn’t list ${label}’s models.`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLoadFailed(false)
                      setAttempt((n) => n + 1)
                    }}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {groups.map((group) => (
                <CommandGroup key={group.label} heading={group.label}>
                  {group.models.map((model) => (
                    <CommandItem
                      key={model.id}
                      // The id keeps two providers' same-named models apart;
                      // the keywords let search match the name and provider.
                      value={model.id}
                      keywords={[model.label, group.label]}
                      onSelect={() => toggle(model)}
                    >
                      <Checkbox
                        checked={chosenIds.has(model.id)}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                      <span className="truncate">{model.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

const NONE: HarnessModelChoice[] = []

function groupByProvider(models: HarnessModelChoice[]) {
  const byLabel = new Map<string, HarnessModelChoice[]>()
  for (const model of models) {
    const group = byLabel.get(model.group)
    if (group) group.push(model)
    else byLabel.set(model.group, [model])
  }
  return [...byLabel].map(([label, list]) => ({ label, models: list }))
}

/** How many chosen models the CLI still lists. */
function countIn(chosen: HarnessModelChoice[], all: HarnessModelChoice[]) {
  const ids = new Set(all.map((m) => m.id))
  return chosen.filter((m) => ids.has(m.id)).length
}
