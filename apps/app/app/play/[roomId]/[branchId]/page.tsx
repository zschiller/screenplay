import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getUserId } from "@/lib/auth-helpers"
import { listBranchThreads } from "@/lib/comments"
import { canAccess, getRoom } from "@/lib/rooms"
import { readRoomDoc } from "@/lib/yjs/server"
import { YjsRoomProvider } from "@/lib/yjs-host/client"
import type { BranchData, IframeLayerData, RepoData } from "@/lib/types"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"
import { PrototypePlayer } from "@/components/play/prototype-player"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string; branchId: string }>
}): Promise<Metadata> {
  const { roomId } = await params
  const room = await getRoom(roomId)
  return { title: room?.name ? `▶ ${room.name}` : "▶ Prototype Player" }
}

type SearchParams = {
  route?: string
  k?: string
  "iframe-layer"?: string
}

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string; branchId: string }>
  searchParams: Promise<SearchParams>
}) {
  const { roomId, branchId } = await params
  const search = await searchParams

  const userId = await getUserId()
  if (!userId) {
    const dest = `/play/${roomId}/${branchId}`
    redirect(`/sign-in?redirect=${encodeURIComponent(dest)}`)
  }

  const room = await getRoom(roomId)
  if (!room) notFound()
  if (!(await canAccess(roomId, userId))) notFound()

  const docSnapshot = await readRoomDoc(
    roomId,
    ({ branches, iframeLayers, repos }) => {
      const agent = branches.get(branchId) as BranchData | undefined
      const iframeLayerId = search["iframe-layer"]
      const iframeLayer = iframeLayerId
        ? (iframeLayers.get(iframeLayerId) as IframeLayerData | undefined)
        : undefined
      const repo = agent
        ? (repos.get(agent.repoId) as RepoData | undefined)
        : undefined
      return { agent, iframeLayer, repo }
    }
  )

  const { agent, iframeLayer, repo } = docSnapshot
  if (!agent) notFound()

  const initialKnobValues =
    decodeKnobValues(search.k) ?? iframeLayer?.knobValues ?? {}
  const initialRoute = search.route ?? iframeLayer?.route ?? "/"
  const initialSharedState = (iframeLayer?.sharedState ?? {}) as Record<
    string,
    unknown
  >
  const initialThreads = agent.ref
    ? await listBranchThreads(roomId, userId, agent.ref).catch(() => [])
    : []

  return (
    <YjsRoomProvider
      roomId={roomId}
      fallback={
        // The player's chrome is black whatever the theme, so the wait reads
        // on it in the dark token set.
        <div className="dark fixed inset-0 flex bg-black text-foreground">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon" className="mb-1">
                <Spinner
                  aria-label="Connecting"
                  className="text-muted-foreground"
                />
              </EmptyMedia>
              <EmptyTitle>Connecting</EmptyTitle>
              <EmptyDescription className="text-xs/relaxed">
                Joining {room.name || "the canvas"}.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      }
    >
      <PrototypePlayer
        roomId={roomId}
        roomName={room.name}
        agentId={agent.id}
        branch={agent.ref}
        previewDomain={agent.previewDomain}
        initialRoute={initialRoute}
        initialKnobValues={initialKnobValues}
        initialSharedState={initialSharedState}
        iframeLayerId={search["iframe-layer"]}
        initialThreads={initialThreads}
        initialDeviceSizeId={repo?.defaultIframeLayerSizeId}
      />
    </YjsRoomProvider>
  )
}

function decodeKnobValues(
  raw: string | undefined
): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const decoded =
      typeof atob === "function"
        ? atob(decodeURIComponent(raw))
        : Buffer.from(decodeURIComponent(raw), "base64").toString("utf-8")
    const parsed = JSON.parse(decoded)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}
