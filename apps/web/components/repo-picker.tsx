"use client"

import { useEffect, useState } from "react"
import { Folder, FolderLock } from "lucide-react"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { listUserRepos, type GitHubRepo } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"

export type RepoPickerSelection =
  | { kind: "repo"; repo: GitHubRepo }
  | { kind: "config"; config: RepoConfig }

interface RepoPickerProps {
  configs?: RepoConfig[]
  onSelect: (pick: RepoPickerSelection) => void
}

let cachedRepos: GitHubRepo[] | null = null

export function RepoPicker({ configs, onSelect }: RepoPickerProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>(() => cachedRepos ?? [])
  const [loading, setLoading] = useState(cachedRepos === null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await listUserRepos()
      if (cancelled) return
      cachedRepos = data
      setRepos(data)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const configsByRepo = new Map<string, RepoConfig[]>()
  for (const c of configs ?? []) {
    const list = configsByRepo.get(c.repoFullName) ?? []
    list.push(c)
    configsByRepo.set(c.repoFullName, list)
  }
  const reposByFullName = new Map(repos.map((r) => [r.fullName, r]))
  const sortedConfigs = (configs ?? [])
    .slice()
    .sort((a, b) =>
      a.repoFullName === b.repoFullName
        ? a.name.localeCompare(b.name)
        : a.repoFullName.localeCompare(b.repoFullName)
    )
  const otherRepos = repos.filter((r) => !configsByRepo.has(r.fullName))
  const showGroups = (configs?.length ?? 0) > 0

  return (
    <Command>
      <CommandInput placeholder="Search repositories..." />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading repositories…
              </span>
            </div>
          ) : (
            "No repositories found."
          )}
        </CommandEmpty>

        {!loading && showGroups && (
          <CommandGroup heading="Configured repositories">
            {sortedConfigs.map((config) => {
              const repo = reposByFullName.get(config.repoFullName)
              const isPrivate = repo?.private ?? config.private
              return (
                <CommandItem
                  key={config.id}
                  value={`${config.repoFullName} ${config.name}`}
                  onSelect={() => onSelect({ kind: "config", config })}
                >
                  {isPrivate ? <FolderLock /> : <Folder />}
                  <span className="truncate">
                    {config.repoFullName}
                    {config.name ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {config.name}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {!loading && (
          <CommandGroup heading={showGroups ? "Other repositories" : undefined}>
            {(showGroups ? otherRepos : repos).map((repo) => (
              <CommandItem
                key={repo.id}
                value={repo.fullName}
                onSelect={() => onSelect({ kind: "repo", repo })}
              >
                {repo.private ? <FolderLock /> : <Folder />}
                <span className="truncate">{repo.fullName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
