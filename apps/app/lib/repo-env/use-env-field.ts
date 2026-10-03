import { useCallback, useState } from "react"
import type { RepoData } from "@/lib/types"
import { revealCanvasRepoEnv } from "./actions"
import { envVarNames, repoEnvVarNames } from "./names"

/**
 * The Repo settings form's env vars field, as the Canvas Repo env module
 * (#1492) sees it. The values live on the server (#1416): whoever may reveal
 * them (`canReveal`) gets a locked, masked field until they click Reveal,
 * can hide it again (keeping any edit), and saves the whole set back; anyone
 * else starts empty, and the lines they type go over the stored values (the
 * server decides which, `saveCanvasRepoEnv`).
 */
export function useCanvasRepoEnvField({
  roomId,
  repo,
  canReveal,
  onRevealError,
}: {
  roomId: string
  repo: RepoData
  canReveal: boolean
  onRevealError: () => void
}) {
  const hasStored = repoEnvVarNames(repo).length > 0
  const [text, setText] = useState("")
  const [loaded, setLoaded] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [hidden, setHidden] = useState(true)

  const hideable = canReveal && hasStored
  const locked = hideable && (loaded === null || hidden)
  const changed = loaded !== null ? text !== loaded : !locked && text !== ""

  const reveal = () => {
    if (loaded !== null) {
      setHidden(false)
      return
    }
    setRevealing(true)
    revealCanvasRepoEnv(roomId, repo.id)
      .then((values) => {
        setLoaded(values)
        setText(values)
        setHidden(false)
      })
      .catch(onRevealError)
      .finally(() => setRevealing(false))
  }

  /** This Canvas's values as far as the form knows them, for Save to all
   *  (desktop, where the one person there may always reveal them). */
  const valuesForAll = useCallback(async (): Promise<string> => {
    if (changed || loaded !== null) return text
    if (hasStored) return revealCanvasRepoEnv(roomId, repo.id)
    return ""
  }, [changed, loaded, text, hasStored, roomId, repo.id])

  return {
    /** What the field shows: nothing while masked. */
    value: locked ? "" : text,
    onChange: setText,
    /** Typed or edited since the form opened, so Save stores it. */
    changed,
    /** The text Save sends. */
    text,
    valuesForAll,
    access: {
      names: loaded !== null ? envVarNames(text) : repoEnvVarNames(repo),
      owned: canReveal,
      hideable,
      locked,
      revealing,
      onReveal: reveal,
      onHide: () => setHidden(true),
    },
  }
}
