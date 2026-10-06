"use client"

import { useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  CaretUpDownIcon,
  CheckIcon,
  FolderIcon,
} from "@workspace/ui/components/icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import type { DetectedApp } from "@/lib/add-repo/resolver"

/**
 * The add modal's App field for a monorepo: which of the repository's apps the
 * run settings are for. The trigger is a full-width row naming the chosen app
 * (folder icon, name, folder · framework); it opens a searchable list styled
 * like the chats menu, grouped by top folder. Apps already added as their own
 * Repository read "Added" and can't be picked.
 */
export function RepoAppPicker({
  id,
  apps,
  value,
  addedPaths,
  onChange,
}: {
  id: string
  /** Two or more, in picker order (see `sortApps`). */
  apps: DetectedApp[]
  value: DetectedApp
  addedPaths: ReadonlySet<string>
  onChange: (app: DetectedApp) => void
}) {
  const [open, setOpen] = useState(false)
  const groups = groupByTopFolder(apps)

  return (
    <Field>
      <FieldLabel htmlFor={id}>App</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            className="flex min-h-13 w-full min-w-0 items-center gap-3 rounded-lg border border-input p-2 pr-3 text-left transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-input/30 dark:hover:bg-muted"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <FolderIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{value.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {appMeta(value)}
              </span>
            </span>
            <CaretUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command loop className="rounded-none!">
            <CommandInput placeholder="Search apps…" />
            <CommandList className="max-h-[min(20rem,var(--radix-popover-content-available-height))]">
              <CommandEmpty>No matches.</CommandEmpty>
              {groups.map(([folder, list]) => (
                <CommandGroup key={folder} heading={folder}>
                  {list.map((app) => {
                    const added = addedPaths.has(app.path)
                    const chosen = app.path === value.path
                    return (
                      <CommandItem
                        key={app.path}
                        value={app.path}
                        keywords={[app.name, app.framework]}
                        disabled={added}
                        onSelect={() => {
                          onChange(app)
                          setOpen(false)
                        }}
                        className="h-8 py-0"
                      >
                        <FolderIcon className="text-muted-foreground" />
                        <span className="shrink-0 whitespace-nowrap">
                          {app.name}
                        </span>
                        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                          {app.path}
                        </span>
                        <span className="ml-auto shrink-0 pl-2 text-xs whitespace-nowrap text-muted-foreground">
                          {added ? "Added" : app.framework}
                        </span>
                        {chosen && <CheckIcon />}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldDescription>
        {`${apps.length} apps in this repository. Each one you add becomes its own repository.`}
      </FieldDescription>
    </Field>
  )
}

/** "apps/app · Next.js", or just the folder when the framework has no name. */
function appMeta(app: DetectedApp): string {
  return app.framework ? `${app.path} · ${app.framework}` : app.path
}

/** Apps keyed by their top folder ("apps", "packages"), keeping their order. */
function groupByTopFolder(apps: DetectedApp[]): [string, DetectedApp[]][] {
  const groups = new Map<string, DetectedApp[]>()
  for (const app of apps) {
    const folder = app.path.split("/")[0] ?? app.path
    groups.set(folder, [...(groups.get(folder) ?? []), app])
  }
  return [...groups]
}

/**
 * The app the modal suggests: the first not already added (apps come
 * `apps/`-first), else the first.
 */
export function suggestedApp(
  apps: DetectedApp[],
  addedPaths: ReadonlySet<string>
): DetectedApp | undefined {
  return apps.find((app) => !addedPaths.has(app.path)) ?? apps[0]
}

/** What a chosen app writes into Agent instructions when they're untouched. */
export function appInstructions(app: DetectedApp): string {
  return `Work in the app under ${app.path}.`
}
