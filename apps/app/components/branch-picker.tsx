"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { GitBranch } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Spinner } from "@workspace/ui/components/spinner"
import { Kbd } from "@workspace/ui/components/kbd"
import { listRepoBranches, type GitHubBranch } from "@/lib/github-actions"

/**
 * The searchable cmdk branch list, shared by every place that needs the user to
 * pick a branch on a Repo: the sidebar's "new branch from branch" picker and the
 * New Workspace dialog's base chip (#325).
 *
 * Pass {@link BranchPickerProps.onDuplicate} to enable the sidebar's dual action
 * — `⌘↵` forks the highlighted branch instead of selecting it, and the picker
 * shows the dual-action hint. Omit it for a plain single-select picker, as the
 * base chip uses (forking there is derived from the chosen base, never a verb).
 */
interface BranchPickerProps {
  owner: string
  repo: string
  onSelect: (branch: string) => void
  onDuplicate?: (branch: string) => void
}

export function BranchPicker({
  owner,
  repo,
  onSelect,
  onDuplicate,
}: BranchPickerProps) {
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [loading, startTransition] = useTransition()
  const metaRef = useRef(false)

  useEffect(() => {
    startTransition(async () => {
      const data = await listRepoBranches(owner, repo)
      setBranches(data)
    })
  }, [owner, repo])

  return (
    <Command>
      <CommandInput
        placeholder="Search branches..."
        onKeyDown={(e) => {
          metaRef.current = e.metaKey
        }}
        onKeyUp={() => {
          metaRef.current = false
        }}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading branches…
              </span>
            </div>
          ) : (
            "No branches found."
          )}
        </CommandEmpty>
        <CommandGroup>
          {branches.map((b) => (
            <CommandItem
              key={b.name}
              value={b.name}
              onSelect={() =>
                onDuplicate && metaRef.current
                  ? onDuplicate(b.name)
                  : onSelect(b.name)
              }
            >
              <GitBranch className="text-sidebar-foreground/70" />
              <span className="flex-1 truncate">{b.name}</span>
              {onDuplicate ? (
                <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground group-data-selected/command-item:flex">
                  <Kbd className="bg-popover">↵</Kbd>
                  <span>Open</span>
                  <Kbd className="ml-1.5 bg-popover">⌘↵</Kbd>
                  <span>Duplicate</span>
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
