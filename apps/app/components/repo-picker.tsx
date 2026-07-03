"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Folder, FolderLock, Link2, Plug } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { cn } from "@workspace/ui/lib/utils"
import { listUserRepos, type GitHubRepo } from "@/lib/github-actions"
import {
  getGitHubLocalStatus,
  resolveRepoFromUrl,
  type GitHubLocalStatus,
} from "@/lib/github-local/actions"
import { looksLikeCloneUrl } from "@/lib/github-local/parse-remote"
import type { NewRepoSource } from "@/lib/github-local/types"
import type { RepoConfig } from "@/lib/repo-configs.types"

export type RepoPickerSelection =
  | { kind: "repo"; repo: GitHubRepo }
  | { kind: "config"; config: RepoConfig }
  /** A Repo from one of the local build's entry points (PRD #428): a pasted
   *  clone URL or a local folder. */
  | { kind: "source"; source: NewRepoSource }

interface RepoPickerProps {
  configs?: RepoConfig[]
  onSelect: (pick: RepoPickerSelection) => void
  /**
   * Show the local build's no-auth add-by-URL entry point (folded into the
   * search box) and, when no token has resolved, a "Connect GitHub in Settings"
   * pointer. Connecting itself lives in Settings now (ADR 0014) — the picker no
   * longer hosts its own connect dialog. Only the in-Room add-Repo surface on
   * the local build sets this; the hosted build's account-backed picker is
   * untouched. The "Open a folder" entry point lives in the dropdown that opens
   * this picker (#604), not in the picker itself.
   */
  localSources?: boolean
}

let cachedRepos: GitHubRepo[] | null = null

export function RepoPicker({
  configs,
  onSelect,
  localSources,
}: RepoPickerProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>(() => cachedRepos ?? [])
  const [loading, setLoading] = useState(cachedRepos === null)
  const [status, setStatus] = useState<GitHubLocalStatus | null>(null)
  // The single search box doubles as a paste-a-URL field: `search` drives both
  // the repo filter and the "Add <url>" row. There is no separate URL screen.
  const [search, setSearch] = useState("")
  // Resolving the pasted URL is a server round-trip (it may hit the GitHub API
  // for the default branch); track its progress and any failure on the row.
  const [urlBusy, setUrlBusy] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  // Reveal a hairline under the search box (the picker's fixed header) once the
  // list is scrolled off its top, matching the create-branches dialog.
  const [listScrolled, setListScrolled] = useState(false)

  // The URL entry is a local-build affordance (resolveRepoFromUrl no-ops on the
  // hosted build) and only lights up once the text actually parses as a URL —
  // a bare repo-name search must never read as one.
  const cloneUrl =
    localSources && looksLikeCloneUrl(search) ? search.trim() : null

  const addUrl = useCallback(
    async (url: string) => {
      setUrlBusy(true)
      setUrlError(null)
      const result = await resolveRepoFromUrl(url)
      if (result.ok) onSelect({ kind: "source", source: result.source })
      else {
        setUrlError(result.error)
        setUrlBusy(false)
      }
    },
    [onSelect]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await listUserRepos()
      if (cancelled) return
      cachedRepos = data
      setRepos(data)
      setLoading(false)
    })()
    if (localSources) {
      getGitHubLocalStatus().then((s) => {
        if (!cancelled) setStatus(s)
      })
    }
    return () => {
      cancelled = true
    }
  }, [localSources])

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

  // No token on the local build: the list being empty has a reason and a fix —
  // surface them instead of a bare "No repositories found." (story 11). It is
  // a prompt, not a gate: the URL / folder entry points below always work.
  const showConnectHint =
    localSources &&
    !loading &&
    repos.length === 0 &&
    status?.tokenSource === null

  return (
    <div>
      <Command>
        <CommandInput
          value={search}
          onValueChange={(value) => {
            setSearch(value)
            setUrlError(null)
            // Filtering snaps the list back to the top without a scroll event.
            setListScrolled(false)
          }}
          placeholder={
            localSources
              ? "Search or paste a repo URL…"
              : "Search repositories…"
          }
        />
        <div className="relative min-h-0 flex-1">
          {/* A single box-shadow draws both the hairline and the soft drop
              beneath it — revealed only while the list is tucked under the
              search box. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-10 h-px shadow-[inset_0_1px_0_0_rgb(0_0_0/0.08),0_3px_8px_0_rgb(0_0_0/0.06)] transition-opacity duration-150 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.1),0_3px_8px_0_rgb(255_255_255/0.06)]",
              listScrolled ? "opacity-100" : "opacity-0"
            )}
          />
          <CommandList
            onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
          >
            {cloneUrl && (
              <CommandGroup>
                <CommandItem
                  // Value mirrors the typed URL so cmdk keeps the row visible
                  // even as the URL filters every repo out of the list.
                  value={cloneUrl}
                  disabled={urlBusy}
                  onSelect={() => addUrl(cloneUrl)}
                >
                  {urlBusy ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Link2 className="text-muted-foreground" />
                  )}
                  <span className="truncate">
                    Add <span className="font-medium">{cloneUrl}</span>
                  </span>
                </CommandItem>
                {urlError && (
                  <p className="px-2 py-1 text-sm text-destructive">
                    {urlError}
                  </p>
                )}
              </CommandGroup>
            )}

            <CommandEmpty>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Spinner className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Loading repositories…
                  </span>
                </div>
              ) : showConnectHint ? (
                <span className="text-sm text-muted-foreground">
                  Connect GitHub to browse your repositories, or paste a clone
                  URL above or add a local folder below.
                </span>
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
              <CommandGroup
                heading={showGroups ? "Other repositories" : undefined}
              >
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
        </div>
      </Command>

      {/* No token on the local build: point at Settings, the one canonical
          connection home (ADR 0014). Shown on `tokenSource === null` alone —
          deliberately not gated on `deviceFlowConfigured`, since the primary
          `gh` path in Settings needs no client id. */}
      {localSources && status?.tokenSource === null && (
        <div className="flex flex-col gap-1 border-t p-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="justify-start gap-2 font-normal"
          >
            <Link href="/settings">
              <Plug className="size-4 text-muted-foreground" />
              Connect GitHub in Settings →
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
