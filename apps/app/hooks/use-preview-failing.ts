import { useEffect, useState } from "react"

import {
  nextPreviewHealth,
  startPreviewHealth,
} from "@/lib/sandbox/dev-server-state"
import type { PreviewProbe, PreviewTarget } from "@/hooks/use-dev-server-probe"
import { probeWorkspacePreview } from "@/lib/sandbox/lifecycle"

const PROBE_INTERVAL_MS = 5000

/**
 * Whether a running dev server's preview keeps failing its probe (#1342):
 * the `crashed` half of the Terminal Pane's dot. Polls the preview while
 * `enabled` and the page is visible. A new preview URL, `enabled` or
 * `launchedAt` (a Run or a Restart, from anyone in the Room) starts the watch
 * over, with the launch's startup grace (`nextPreviewHealth`).
 */
export function usePreviewFailing(
  preview: PreviewTarget | undefined,
  enabled: boolean,
  launchedAt?: number,
  probe: PreviewProbe = probeWorkspacePreview
): boolean {
  const sandboxName = preview?.sandboxName
  const devPort = preview?.devPort
  const url = preview?.url
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
    if (!url || !sandboxName || devPort === undefined || !enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let health = startPreviewHealth(launchedAt)

    const tick = async () => {
      if (!document.hidden) {
        const answered = await probe(sandboxName, devPort).catch(() => false)
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
  }, [sandboxName, devPort, url, enabled, launchedAt, probe])

  return failing
}
