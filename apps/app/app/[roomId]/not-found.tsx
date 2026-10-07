import Link from "next/link"
import { MagnifyingGlassIcon } from "@workspace/ui/components/icons"

import { Button } from "@workspace/ui/components/button"

import { CanvasRouteState } from "@/components/canvas/canvas-route-state"
import { buildIdentity } from "@/lib/capabilities"

/**
 * A Canvas id that doesn't resolve — deleted, mistyped, or (on the hosted
 * build) not shared with this user. The route answers both "missing" and "no
 * access" with `notFound()`, deliberately indistinguishable, so this copy covers
 * both without saying which.
 */
export default function CanvasNotFound() {
  return (
    <CanvasRouteState
      icon={<MagnifyingGlassIcon />}
      title="Canvas not found"
      description={
        buildIdentity === "host"
          ? "This canvas doesn’t exist. It may have been deleted, or the link is wrong."
          : "This canvas doesn’t exist, or it hasn’t been shared with you."
      }
    >
      <Button size="sm" asChild>
        <Link href="/files">Go to All files</Link>
      </Button>
    </CanvasRouteState>
  )
}
