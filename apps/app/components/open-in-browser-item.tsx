"use client"

import { ExternalLink } from "lucide-react"
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu"
import { openExternal } from "@/lib/open-external"

/**
 * Shared "Open in browser" dropdown item — pops a branch's live preview out of
 * the app and into a real browser tab, outside the prototype-player wrapper.
 *
 * Rendered identically by the frame toolbar's `…` drawer and the branch
 * overflow menu so the two surfaces never drift; the only difference is the
 * `url` the caller passes — the frame deep-links the route it's currently
 * showing (`previewDomain + route`), the branch opens the preview root
 * (`previewDomain`). Disabled until a preview URL exists.
 */
export function OpenInBrowserItem({ url }: { url?: string }) {
  return (
    <DropdownMenuItem
      disabled={!url}
      onSelect={() => {
        if (url) openExternal(url)
      }}
    >
      <ExternalLink />
      Open in browser
    </DropdownMenuItem>
  )
}
