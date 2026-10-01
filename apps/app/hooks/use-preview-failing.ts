import { useEffect, useState } from "react"

import {
  nextPreviewHealth,
  startPreviewHealth,
} from "@/lib/sandbox/dev-server-state"
import { probeSandboxUrl } from "@/lib/sandbox/lifecycle"

const PROBE_INTERVAL_MS = 5000

/**
 * Whether a running dev server's preview keeps failing its probe (#1342):
 * the `crashed` half of the Terminal Pane's dot. Polls `url` while `enabled`
 * and the page is visible. A new `url`, `enabled` or `launchedAt` (a Run or a
 * Restart, from anyone in the Room) starts the watch over, with the launch's
 * startup grace (`nextPreviewHealth`).
 */
export function usePreviewFailing(
  url: string | undefined,
  enabled: boolean,
  launchedAt?: number,
  probe: (url: string) => Promise<boolean> = probeSandboxUrl
): boolean {
  const [failing, setFailing] = useState(false)
  const [watch, setWatch] = useState({ url, enabled, launchedAt })
  // Reset during render, not in the effect, when the watch target changes.
  if (
    watch.url !== url ||
    watch.enabled !== enabled ||
    watch.launchedAt !== launchedAt
  ) {
    setWatch({ url, enabled, launchedAt })
    setFailing(false)
  }

  useEffect(() => {
    if (!url || !enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let health = startPreviewHealth(launchedAt)

    const tick = async () => {
      if (!document.hidden) {
        const answered = await probe(url).catch(() => false)
        if (cancelled) return
        health = nextPreviewHealth(health, answered, Date.now())
        setFailing(health.failing)
      }
      if (!cancelled) timer = setTimeout(tick, PROBE_INTERVAL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url, enabled, launchedAt, probe])

  return failing
}
