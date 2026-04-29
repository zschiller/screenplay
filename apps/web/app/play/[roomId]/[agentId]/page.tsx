import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getUserId } from "@/lib/auth-helpers"
import { listBranchThreads } from "@/lib/comments"
import { canAccess, getRoom } from "@/lib/rooms"
import { readRoomDoc } from "@/lib/yjs/server"
import { YjsRoomProvider } from "@/lib/yjs-host/client"
import type { AgentData, ArtboardData, WorkspaceData } from "@/lib/types"
import { PrototypePlayer } from "@/components/play/prototype-player"

export const metadata: Metadata = {
  title: "Prototype Player",
}

type SearchParams = {
  route?: string
  k?: string
  artboard?: string
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
    ({ agents, artboards, workspaces }) => {
      const agent = agents.get(agentId) as AgentData | undefined
      const artboardId = search.artboard
      const artboard = artboardId
        ? (artboards.get(artboardId) as ArtboardData | undefined)
        : undefined
      const workspace = agent
        ? (workspaces.get(agent.workspaceId) as WorkspaceData | undefined)
        : undefined
      return { agent, artboard, workspace }
    },
  )

  const { agent, artboard, workspace } = docSnapshot
  if (!agent) notFound()

  const initialKnobValues = decodeKnobValues(search.k) ?? artboard?.knobValues ?? {}
  const initialRoute = search.route ?? artboard?.route ?? "/"
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
        initialThreads={initialThreads}
        initialDeviceSizeId={workspace?.defaultArtboardSizeId}
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
