import { useEffect, useState } from "react"

import { isLocalBuild } from "@/lib/local-mode"

type TauriInvoke = (cmd: string, args?: unknown) => Promise<unknown>

/** The Tauri IPC bridge, when this page is running inside the desktop shell. */
function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } }
  ).__TAURI_INTERNALS__
  return typeof internals?.invoke === "function" ? internals.invoke : null
}

/**
 * Whether the macOS window traffic lights are currently occupying the
 * top-left of the webview.
 *
 * True only on the desktop build (`isLocalBuild`) and only when the window is
 * NOT in native fullscreen — macOS hides the traffic lights in fullscreen, so
 * UI that reserves space for them should reclaim it.
 *
 * Fullscreen comes from Tauri's real window state (`plugin:window|is_fullscreen`,
 * already granted by `core:window:default`), re-queried on every `resize` —
 * which fires on each fullscreen transition. A `screen.height` heuristic is only
 * a fallback for the local build opened in a plain browser (no Tauri bridge);
 * it's unreliable inside the app (e.g. notched Macs keep fullscreen content
 * below the notch, so the window never reaches the full screen height).
 */
export function useTrafficLightsPresent(): boolean {
  // Default to present on the desktop build so the first paint reserves space
  // for the common (non-fullscreen) case; the effect corrects it on mount.
  const [present, setPresent] = useState(isLocalBuild)

  useEffect(() => {
    if (!isLocalBuild) return
    const invoke = getTauriInvoke()
    let cancelled = false

    const update = () => {
      if (invoke) {
        invoke("plugin:window|is_fullscreen")
          .then((fullscreen) => {
            if (!cancelled) setPresent(!fullscreen)
          })
          .catch(() => {})
      } else if (!cancelled) {
        setPresent(window.innerHeight < window.screen.height)
      }
    }

    update()
    window.addEventListener("resize", update)
    return () => {
      cancelled = true
      window.removeEventListener("resize", update)
    }
  }, [])

  return present
}
