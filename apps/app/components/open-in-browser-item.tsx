"use client"

import { ExternalLink } from "lucide-react"
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu"

/**
 * Shared "Open in browser" dropdown item — pops a branch's live preview out of
 * the app and into a real browser tab, outside the prototype-player wrapper.
 *
 * Rendered identically by the frame toolbar's `…` drawer and the branch
 * overflow menu so the two surfaces never drift; the only difference is the
 * `onOpen` the caller wires — the frame deep-links the route it's currently
 * showing, the branch opens the preview root. Both go through
 * {@link openPreviewInBrowser}, which prefers portless's stable named URL over
 * the port-based proxy URL. Disabled until a preview URL exists.
 */
export function OpenInBrowserItem({
  disabled,
  onOpen,
}: {
  disabled?: boolean
  onOpen: () => void
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onOpen}>
      <ExternalLink />
      Open in browser
    </DropdownMenuItem>
  )
}
