/**
 * Going local from a shared frame (#1397): copy the shared browser's cookies
 * and local storage onto the preview's origin in this viewer's browser, so the
 * local iframe starts where the shared one is. In-memory state can't come
 * along.
 *
 * A hidden iframe loads the proxy's seed page (`/__screenplay-seed`, see
 * `lib/sandbox-bridge/proxy.mjs`) on the preview's origin. It says it's ready,
 * takes the snapshot over postMessage, writes local storage, has the proxy set
 * the cookies (HttpOnly ones too), and says it's done. Same origin and same
 * top-level page as the local iframe, so it writes the storage that iframe
 * reads.
 */

import type { FrameSnapshot } from "@/lib/frame-stream/protocol"

const SEED_PATH = "/__screenplay-seed"
const SEED_TIMEOUT_MS = 5000

/** True once the preview's origin holds the snapshot's cookies and storage;
 *  false when the seed page didn't answer (an older Sandbox) or failed. */
export function seedLocalFrame(
  previewUrl: string,
  snapshot: FrameSnapshot,
  { timeoutMs = SEED_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<boolean> {
  let url: URL
  try {
    url = new URL(SEED_PATH, previewUrl)
  } catch {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const frame = document.createElement("iframe")
    frame.setAttribute("aria-hidden", "true")
    frame.tabIndex = -1
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin")
    frame.style.cssText =
      "position:fixed;width:0;height:0;border:0;visibility:hidden"

    const finish = (ok: boolean) => {
      clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      frame.remove()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return
      const data = e.data as { type?: string; ok?: boolean } | null
      if (data?.type === "screenplay:seed-ready") {
        frame.contentWindow?.postMessage(
          {
            type: "screenplay:seed",
            cookies: snapshot.cookies,
            localStorage: snapshot.localStorage,
          },
          url.origin
        )
      } else if (data?.type === "screenplay:seeded") {
        finish(data.ok === true)
      }
    }
    window.addEventListener("message", onMessage)
    frame.src = url.href
    document.body.appendChild(frame)
  })
}
