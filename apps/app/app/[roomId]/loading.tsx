import { cookies } from "next/headers"

import { CanvasSkeleton } from "@/components/canvas/canvas-skeleton"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"

/**
 * What the Canvas route shows while its server render runs (#735). The same
 * skeleton the room provider shows while the Y.Doc syncs, read off the same
 * layout cookie, so the two hand over without a jump.
 */
export default async function CanvasLoading() {
  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("canvas-layout"))?.value
  )
  return <CanvasSkeleton initialLayout={initialLayout} />
}
