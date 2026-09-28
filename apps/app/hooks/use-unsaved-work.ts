"use client"

import { useEffect, useState } from "react"

import type { UnsavedWork } from "@/lib/branch/unsaved-work"
import { getUnsavedWork } from "@/lib/sandbox/git"

export interface UnsavedWorkTarget {
  /** The Workspace (Branch) id the answer is keyed by. */
  id: string
  sandboxName: string
  ref: string
}

/**
 * Read each Workspace's git state while a delete confirm is open (issue #776),
 * keyed by Workspace id. An id is absent while its read is in flight, and maps
 * to `null` once answered when the checkout couldn't be read.
 *
 * Re-read on every open rather than cached: the checkout moves while the agent
 * works, and the answer decides whether the dialog warns about lost commits.
 */
export function useUnsavedWork(
  targets: UnsavedWorkTarget[],
  defaultBranch: string | undefined,
  enabled: boolean
): ReadonlyMap<string, UnsavedWork | null> {
  const [results, setResults] = useState<{
    key: string
    work: ReadonlyMap<string, UnsavedWork | null>
  }>(() => ({ key: "", work: new Map() }))
  // A stable key for the effect: the same Workspaces read the same way.
  const key = enabled
    ? `${defaultBranch ?? ""}|${targets.map((t) => `${t.id}:${t.sandboxName}:${t.ref}`).join(",")}`
    : ""

  // Start empty on every open (and drop answers on close), so a reopen never
  // shows the last open's answers as current. The previous-prop pattern rather
  // than an effect (see react.dev "You Might Not Need an Effect").
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setResults({ key, work: new Map() })
  }

  useEffect(() => {
    if (!key) return
    let cancelled = false
    for (const target of targets) {
      void getUnsavedWork(
        target.sandboxName,
        target.ref,
        defaultBranch ?? "main"
      )
        .catch(() => null)
        .then((work) => {
          if (cancelled) return
          setResults((prev) =>
            prev.key === key
              ? { key, work: new Map(prev.work).set(target.id, work) }
              : prev
          )
        })
    }
    return () => {
      cancelled = true
    }
    // `key` captures every input the reads depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return results.work
}
