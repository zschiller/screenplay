export type TauriInvoke = (cmd: string, args?: unknown) => Promise<unknown>

/** The Tauri IPC bridge, when this page is running inside the desktop shell. */
export function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } }
  ).__TAURI_INTERNALS__
  return typeof internals?.invoke === "function" ? internals.invoke : null
}
