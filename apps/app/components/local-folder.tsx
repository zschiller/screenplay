"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { withBasePath } from "@/lib/base-path"
import { inspectLocalRepoPath } from "@/lib/github-local/actions"
import type { NewRepoSource } from "@/lib/github-local/types"

/**
 * Outcome of firing the native directory dialog:
 *  - `source`    the user picked a folder that resolved to a Repo
 *  - `fallback`  no native picker is reachable (sidecar driven from a browser
 *                in development) or the pick failed to resolve — the caller
 *                should swap in the path-input form (story 27)
 *  - `cancelled` the dialog opened but the user dismissed it
 */
export type ChooseLocalFolderResult =
  | { kind: "source"; source: NewRepoSource }
  | { kind: "fallback" }
  | { kind: "cancelled" }

/**
 * Fire the native OS directory dialog via the Tauri shell's control server and
 * resolve the chosen path to a Repo source. The add-project dropdown (#604)
 * calls this directly; outside the shell it reports unavailable so the caller
 * can fall back to a plain path input.
 */
export async function chooseLocalFolder(): Promise<ChooseLocalFolderResult> {
  try {
    const res = await fetch(withBasePath("/api/local/pick-directory"), {
      method: "POST",
    })
    const data = (await res.json()) as {
      available: boolean
      path?: string | null
    }
    if (!data.available) return { kind: "fallback" }
    if (!data.path) return { kind: "cancelled" }
    const result = await inspectLocalRepoPath(data.path)
    if (result.ok) return { kind: "source", source: result.source }
    // Surface the resolve error through the path form.
    return { kind: "fallback" }
  } catch {
    return { kind: "fallback" }
  }
}

/**
 * The folder-path form — the fallback when no native directory picker is
 * reachable (story 27). The clone-URL entry is not a mode here: it lives folded
 * into the picker's search box (#603).
 */
export function LocalFolderForm({
  onBack,
  onResolved,
}: {
  onBack: () => void
  onResolved: (source: NewRepoSource) => void
}) {
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const result = await inspectLocalRepoPath(value)
    if (result.ok) {
      onResolved(result.source)
    } else {
      setError(result.error)
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) submit()
      }}
    >
      <span className="text-sm font-medium">Add a local folder</span>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="/path/to/your/clone"
      />
      {error && <span className="text-sm text-destructive">{error}</span>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={busy || !value.trim()}>
          {busy ? <Spinner className="size-4" /> : "Add"}
        </Button>
      </div>
    </form>
  )
}
