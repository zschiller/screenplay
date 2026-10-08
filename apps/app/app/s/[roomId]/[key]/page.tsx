import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { Canvas } from "@/components/canvas/canvas"
import { CanvasSkeleton } from "@/components/canvas/canvas-skeleton"
import { PAGE_PARAM } from "@/lib/canvas/pages"
import { listThreads } from "@/lib/comments"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"
import { getRoom } from "@/lib/rooms"
import { ViewingProvider } from "@/lib/viewer/context"
import { requestRole } from "@/lib/viewer-identity/request"
import { YjsRoomProvider } from "@/lib/yjs-host/y-websocket-client"
import { isShareKey } from "@/server/share-link.mjs"

type Params = Promise<{ roomId: string; key: string }>

/** The canvas a link names, when the key is its own. */
async function linkedRoom(params: Params) {
  const { roomId, key } = await params
  if (!isShareKey(roomId, key)) return null
  const room = await getRoom(roomId)
  return room ? { room, key } : null
}

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const linked = await linkedRoom(params)
  return { title: linked?.room.name ?? "Canvas not found" }
}

/**
 * A canvas's link (Sharing, #1932): a viewer on the viewer listener watches
 * the canvas live, read-only plus presence. Without the canvas's own key
 * there is nothing here. The host, who reaches this on the host listener,
 * goes to the canvas itself.
 */
export default async function SharedCanvasPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const role = await requestRole()
  const linked = await linkedRoom(params)
  if (!linked || role.role === "refused") notFound()
  const { room, key } = linked
  if (role.role === "host") redirect(`/${room.id}`)

  const linkedPage = (await searchParams)[PAGE_PARAM]
  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("canvas-layout"))?.value
  )
  const initialThreads = await listThreads(room.id).catch(() => undefined)

  return (
    <ViewingProvider
      value={{ person: role.person, roomId: room.id, shareKey: key }}
    >
      <YjsRoomProvider
        roomId={room.id}
        viewerKey={key}
        fallback={<CanvasSkeleton initialLayout={initialLayout} />}
      >
        <Canvas
          roomId={room.id}
          roomName={room.name}
          isOwner={false}
          sharedWithCount={0}
          hasThumbnail={!!room.thumbnailManifest}
          parentFolder={null}
          initialLayout={initialLayout}
          initialThreads={initialThreads}
          initialTerminalTabs={[]}
          initialPageId={
            typeof linkedPage === "string" ? linkedPage : undefined
          }
        />
      </YjsRoomProvider>
    </ViewingProvider>
  )
}
