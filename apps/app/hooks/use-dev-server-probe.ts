import { useCallback, useEffect, useRef, useState } from "react"
import { probeSandboxUrl } from "@/lib/sandbox/lifecycle"

/**
 * The probe runs as an explicit three-state machine:
 *  - `waiting`  — polling; the dev server isn't reachable yet
 *  - `ready`    — the dev server answered, the live preview can mount
 *  - `timedout` — the probe window elapsed with no reachable server; the UI
 *                 shows an actionable "not responding" state instead of an
 *                 infinite spinner, and `retry()` re-enters `waiting`.
 */
export type DevServerProbeState = "waiting" | "ready" | "timedout"

const PROBE_INTERVAL_MS = 2000
const MAX_PROBES = 60 // ~2 minutes

export interface UseDevServerProbeOptions {
  /** Delay between probe attempts. Defaults to 2s. */
  intervalMs?: number
  /** Max number of attempts before giving up. Defaults to 60 (~2 minutes). */
  maxProbes?: number
  /** Reachability check. Injectable so the loop is testable without a network. */
  probe?: (url: string) => Promise<boolean>
}

export interface DevServerProbe {
  state: DevServerProbeState
  /** Restart the probe from scratch (back to `waiting`). */
  retry: () => void
}

/**
 * Polls `url` until the dev server is reachable, surfacing the result as an
 * explicit state machine. Passing `undefined` (no URL yet) holds in `waiting`
 * without probing. Changing `url` restarts the probe.
 */
export function useDevServerProbe(
  url: string | undefined,
  options: UseDevServerProbeOptions = {}
): DevServerProbe {
  const {
    intervalMs = PROBE_INTERVAL_MS,
    maxProbes = MAX_PROBES,
    probe = probeSandboxUrl,
  } = options

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
    if (!url) {
      setState("waiting")
      return
    }

    let cancelled = false
    setState("waiting")

    async function poll() {
      let probes = 0
      while (!cancelled && probes < maxProbesRef.current) {
        const up = await probeRef.current(url!)
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
  }, [url, attempt])
  /* eslint-enable react-hooks/set-state-in-effect */

  return { state, retry }
}
