import { useCallback, useEffect, useRef, useState } from "react"
import { probeWorkspacePreview } from "@/lib/sandbox/lifecycle"

/**
 * The probe runs as an explicit three-state machine:
 *  - `waiting`  — polling; the dev server isn't reachable yet
 *  - `ready`    — the dev server answered, the live preview can mount
 *  - `timedout` — the probe window elapsed with no reachable server; the UI
 *                 shows an actionable "not responding" state instead of an
 *                 infinite spinner, and `retry()` re-enters `waiting`.
 */
export type DevServerProbeState = "waiting" | "ready" | "timedout"

/**
 * The Workspace preview to probe: its Sandbox and Dev Server Port, which the
 * server probes at its own address, and the URL the frame loads, which only
 * keys the probe (a new URL starts it over). The server is never handed a URL.
 */
export type PreviewTarget = {
  sandboxName: string
  devPort: number
  url: string
}

/** Whether a Workspace's preview answers. */
export type PreviewProbe = (
  sandboxName: string,
  devPort: number
) => Promise<boolean>

const PROBE_INTERVAL_MS = 2000
const MAX_PROBES = 60 // ~2 minutes

export interface UseDevServerProbeOptions {
  /** Delay between probe attempts. Defaults to 2s. */
  intervalMs?: number
  /** Max number of attempts before giving up. Defaults to 60 (~2 minutes). */
  maxProbes?: number
  /** Reachability check. Injectable so the loop is testable without a network. */
  probe?: PreviewProbe
}

export interface DevServerProbe {
  state: DevServerProbeState
  /** Restart the probe from scratch (back to `waiting`). */
  retry: () => void
}

/**
 * Polls the preview until the dev server is reachable, surfacing the result
 * as an explicit state machine. Passing `undefined` (no preview URL yet) holds
 * in `waiting` without probing. A different target restarts the probe.
 */
export function useDevServerProbe(
  preview: PreviewTarget | undefined,
  options: UseDevServerProbeOptions = {}
): DevServerProbe {
  const {
    intervalMs = PROBE_INTERVAL_MS,
    maxProbes = MAX_PROBES,
    probe = probeWorkspacePreview,
  } = options
  const sandboxName = preview?.sandboxName
  const devPort = preview?.devPort
  const url = preview?.url

  const [state, setState] = useState<DevServerProbeState>("waiting")

  // Bumped by retry() to force the probe effect to re-run from scratch even
  // when the URL is unchanged.
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState("waiting")
    setAttempt((n) => n + 1)
  }, [])

  // Hold options in refs so an inline `probe` callback or literal interval/max
  // (which get fresh identities each render) doesn't restart the probe loop.
  const probeRef = useRef(probe)
  const intervalRef = useRef(intervalMs)
  const maxProbesRef = useRef(maxProbes)
  useEffect(() => {
    probeRef.current = probe
    intervalRef.current = intervalMs
    maxProbesRef.current = maxProbes
  })

  // The probe drives external network state into React state; the setState
  // calls here are the intended sync, not an avoidable render cascade.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!url || !sandboxName || devPort === undefined) {
      setState("waiting")
      return
    }

    let cancelled = false
    setState("waiting")

    async function poll() {
      let probes = 0
      while (!cancelled && probes < maxProbesRef.current) {
        const up = await probeRef
          .current(sandboxName!, devPort!)
          .catch(() => false)
        if (cancelled) return
        if (up) {
          setState("ready")
          return
        }
        probes++
        if (probes >= maxProbesRef.current) break
        await new Promise((r) => setTimeout(r, intervalRef.current))
      }
      if (!cancelled) setState("timedout")
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [sandboxName, devPort, url, attempt])
  /* eslint-enable react-hooks/set-state-in-effect */

  return { state, retry }
}
