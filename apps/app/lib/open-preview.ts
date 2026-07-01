"use client"

import { getStableDevUrl } from "@/lib/sandbox/lifecycle"
import { openExternal } from "@/lib/open-external"
import type { RepoData } from "@/lib/types"

/**
 * Open a Branch's live preview in the system browser, preferring portless's
 * stable named route (`http://<branch>.<app>.localhost:1355`) over the
 * port-based proxy URL.
 *
 * `fallbackBase` is the Branch's `previewDomain` — the bridge proxy on a random
 * ephemeral host port the allocator hands out per Sandbox. That's the right URL
 * for the in-app iframe, but a poor thing to hand a human: the port is
 * meaningless and changes across dev-server restarts. So when portless has a
 * live named route for this dev server ({@link getStableDevUrl}, desktop-only)
 * we open that instead; otherwise — the hosted backend, or no daemon/route up —
 * we fall back to the port-based URL so the action always opens *something*.
 *
 * `route` (e.g. `/settings`) is appended to whichever base wins, so the frame
 * toolbar's "open the route I'm showing" deep-link survives either path. Both
 * bases are origin-only (no trailing slash), matching how the iframe composes
 * `iframeUrl + route`.
 */
export async function openPreviewInBrowser({
  sandboxName,
  repo,
  fallbackBase,
  route = "",
}: {
  sandboxName: string
  repo: RepoData
  fallbackBase: string
  route?: string
}): Promise<void> {
  let base = fallbackBase
  try {
    const result = await getStableDevUrl(sandboxName, repo)
    if (result.success && result.value.url) base = result.value.url
  } catch {
    // Any failure resolving the named route just falls through to the
    // port-based URL — the open action must never become a no-op.
  }
  openExternal(base + route)
}
