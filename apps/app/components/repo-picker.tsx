"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  FolderIcon,
  FolderLockIcon,
  LinkSimpleHorizontalIcon,
  PlugIcon,
} from "@workspace/ui/components/icons"
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
import { listUserRepos, type GitHubRepo } from "@/lib/github-actions"
import {
  getGitHubLocalStatus,
  resolveRepoFromUrl,
  type GitHubLocalStatus,
} from "@/lib/github-local/actions"
import { ListScrollHairline } from "@/components/picker-dialog"
import { looksLikeCloneUrl } from "@/lib/github-local/parse-remote"
import type { NewRepoSource } from "@/lib/github-local/types"

export type RepoPickerSelection =
  | { kind: "repo"; repo: GitHubRepo }
  /** A Repo from one of the local build's entry points (PRD #428): a pasted
   *  clone URL or a local folder. */
  | { kind: "source"; source: NewRepoSource }

interface RepoPickerProps {
  onSelect: (pick: RepoPickerSelection) => void
  /**
   * Show the local build's no-auth add-by-URL entry point (folded into the
   * search box) and, when no token has resolved, a "Connect GitHub"
   * pointer. Connecting itself lives in Settings now (ADR 0014) — the picker no
   * longer hosts its own connect dialog. Only the in-Room add-Repo surface on
   * the local build sets this; the hosted build's account-backed picker is
   * untouched. The "Open a folder" entry point lives in the dropdown that opens
   * this picker (#604), not in the picker itself.
   */
  localSources?: boolean
}

let cachedRepos: GitHubRepo[] | null = null

export function RepoPicker({ onSelect, localSources }: RepoPickerProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>(() => cachedRepos ?? [])
  const [loading, setLoading] = useState(cachedRepos === null)
  // The list failed to load (GitHub or the server errored), as opposed to
  // loading fine and being empty. Try again bumps `attempt` to reload.
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
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
      try {
        const data = await listUserRepos()
        if (cancelled) return
        cachedRepos = data
        setRepos(data)
      } catch {
        if (!cancelled) setLoadFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    if (localSources) {
      getGitHubLocalStatus()
        .then((s) => {
          if (!cancelled) setStatus(s)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [localSources, attempt])

  const retry = () => {
    setLoadFailed(false)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  // No token on the local build: the list being empty has a reason and a fix —
  // surface them instead of a bare "No repositories found." (story 11). It is
  // a prompt, not a gate: the URL / folder entry points below always work.
  const showConnectHint =
    localSources &&
    !loading &&
    !loadFailed &&
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
              ? "Search or paste a clone URL…"
              : "Search GitHub repositories…"
          }
        />
        <div className="relative min-h-0 flex-1">
          <ListScrollHairline shown={listScrolled} />
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
                    <LinkSimpleHorizontalIcon className="text-muted-foreground" />
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

            {/* Only once the list has loaded: while loading, or after a
                failed load, the block below says why there is nothing. */}
            {!loading && !loadFailed && !showConnectHint && (
              <CommandEmpty>No GitHub repositories found.</CommandEmpty>
            )}

            {/* No token: point at Settings, the one canonical connection home
                (ADR 0014). A plain block rather than CommandEmpty so it stays
                under the URL row too, whatever the search. Not gated on
                `deviceFlowConfigured`: the `gh` path in Settings needs no
                client id. */}
            {showConnectHint && !cloneUrl && (
              <div className="flex flex-col items-center gap-3 py-6">
                <span className="text-sm text-muted-foreground">
                  Connect GitHub to see your repositories here.
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings?section=github">
                    <PlugIcon />
                    Connect GitHub
                  </Link>
                </Button>
              </div>
            )}

            {loading || loadFailed ? (
              // Centred at the height the original loading line had
              // (CommandEmpty's py-6 around a py-4 row). A plain block rather
              // than CommandEmpty so it stays up whatever the search (#781).
              loading ? (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-10"
                >
                  <Spinner className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Loading GitHub repositories…
                  </span>
                </div>
              ) : (
                <div
                  role="alert"
                  className="flex flex-col items-center gap-3 py-8"
                >
                  <span className="text-sm text-muted-foreground">
                    Couldn&apos;t load your GitHub repositories.
                  </span>
                  <Button variant="outline" size="sm" onClick={retry}>
                    Try again
                  </Button>
                </div>
              )
            ) : (
              repos.length > 0 && (
                <CommandGroup>
                  {repos.map((repo) => (
                    <CommandItem
                      key={repo.id}
                      value={repo.fullName}
                      onSelect={() => onSelect({ kind: "repo", repo })}
                    >
                      {repo.private ? <FolderLockIcon /> : <FolderIcon />}
                      <span className="truncate">{repo.fullName}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            )}
          </CommandList>
        </div>
      </Command>
    </div>
  )
}
