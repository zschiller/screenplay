import { getTauriInvoke } from "@/lib/desktop/tauri-bridge"

/**
 * Open a URL in the user's default browser.
 *
 * In a plain web browser this is just `window.open`. Inside the desktop shell
 * (Tauri's WKWebView) `window.open`/`target="_blank"` silently no-op — the
 * webview has no popup surface — so route through the opener plugin's
 * `open_url` IPC command, which hands the URL to the OS. Relative URLs are
 * resolved against the current origin first so the plugin always receives an
 * absolute URL (the scope only allows `http(s)://`, see capabilities/default.json).
 */
export function openExternal(url: string): void {
  const invoke = getTauriInvoke()
  if (invoke) {
    const absolute =
      typeof window !== "undefined"
        ? new URL(url, window.location.href).href
        : url
    void invoke("plugin:opener|open_url", { url: absolute }).catch(
      (error: unknown) => {
        console.error("[openExternal] opener plugin failed", absolute, error)
      }
    )
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
