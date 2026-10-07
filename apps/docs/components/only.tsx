import { Badge } from "@workspace/ui/components/badge"

/**
 * Marks a section, list item or table row that exists in one build only.
 * Goes on the line under a heading or at the start of a cell, never inside
 * a heading, so anchors stay `#github` rather than `#github-desktop`.
 */
export function Only({
  desktop,
  hosted,
  headless,
}: {
  desktop?: boolean
  hosted?: boolean
  headless?: boolean
}) {
  return (
    <Badge variant="outline" className="sp-only">
      {desktop ? "Desktop" : hosted ? "Hosted" : headless ? "Headless" : null}
    </Badge>
  )
}
