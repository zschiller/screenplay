import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getUserId } from "@/lib/auth-helpers"
import { listBranchThreads } from "@/lib/comments"
import { canAccess, getRoom } from "@/lib/rooms"
import { readRoomDoc } from "@/lib/yjs/server"
import { YjsRoomProvider } from "@/lib/yjs-host/client"
import type { AgentData, IframeLayerData, WorkspaceData } from "@/lib/types"
import { PrototypePlayer } from "@/components/play/prototype-player"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string; agentId: string }>
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
  params: Promise<{ roomId: string; agentId: string }>
  searchParams: Promise<SearchParams>
}) {
  const { roomId, agentId } = await params
  const search = await searchParams

  const userId = await getUserId()
  if (!userId) {
    const dest = `/play/${roomId}/${agentId}`
    redirect(`/sign-in?redirect=${encodeURIComponent(dest)}`)
  }

  const room = await getRoom(roomId)
  if (!room) notFound()
  if (!(await canAccess(roomId, userId))) notFound()

  const docSnapshot = await readRoomDoc(
    roomId,
    ({ agents, iframeLayers, workspaces }) => {
      const agent = agents.get(agentId) as AgentData | undefined
      const iframeLayerId = search["iframe-layer"]
      const iframeLayer = iframeLayerId
        ? (iframeLayers.get(iframeLayerId) as IframeLayerData | undefined)
        : undefined
      const workspace = agent
        ? (workspaces.get(agent.workspaceId) as WorkspaceData | undefined)
        : undefined
      return { agent, iframeLayer, workspace }
    },
  )

  const { agent, iframeLayer, workspace } = docSnapshot
  if (!agent) notFound()

  const initialKnobValues = decodeKnobValues(search.k) ?? iframeLayer?.knobValues ?? {}
  const initialRoute = search.route ?? iframeLayer?.route ?? "/"
  const initialSharedState = (iframeLayer?.sharedState ?? {}) as Record<string, unknown>
  const initialThreads = agent.branch
    ? await listBranchThreads(roomId, userId, agent.branch).catch(() => [])
    : []

  return (
    <YjsRoomProvider
      roomId={roomId}
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-black text-xs text-white/60">
          Connecting…
        </div>
      }
    >
      <PrototypePlayer
        roomId={roomId}
        projectName={room.name}
        agentId={agent.id}
        branch={agent.branch}
        previewDomain={agent.previewDomain}
        initialRoute={initialRoute}
        initialKnobValues={initialKnobValues}
        initialSharedState={initialSharedState}
        iframeLayerId={search["iframe-layer"]}
        initialThreads={initialThreads}
        initialDeviceSizeId={workspace?.defaultIframeLayerSizeId}
      />
    </YjsRoomProvider>
  )
}

function decodeKnobValues(
  raw: string | undefined,
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
