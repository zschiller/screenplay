import "server-only"

import { frameControlKey } from "@/lib/canvas/frame-control"
import { AgentFrameDriver } from "@/lib/frame-drive/agent-driver"
import {
  hostedFrameDriveBackend,
  type HostedFrame,
} from "@/lib/frame-drive/hosted/backend"
import { routeChatDriver } from "@/lib/frame-drive/hosted/router"
import { roomFrameControlStore } from "@/lib/frame-drive/server"
import type { FrameDriver } from "@/lib/frame-drive/tools"
import { viewAgentDriver, viewCanvasOf } from "@/lib/frame-drive/view/live"
import { frameStreamKey } from "@/lib/frame-stream/token"
import { mockupRefs, type MockupResources } from "@/lib/mockup-refs"
import { mockupRefSources, resolveMockupRefs } from "@/lib/mockup-refs-server"
import type { RoomDoc } from "@/lib/room-access"
import { ensureFrameStream } from "@/lib/sandbox/frame-stream"
import { MOCKUP_RUNTIME_JS } from "@/lib/sandbox-bridge"
import { mockupHtml, mockupSrcDoc } from "@/lib/yjs/mockup-html"

// One driver per Room for the process: every chat's agent is the same party
// on a shared frame, and the driver remembers which frames it holds between
// tool calls. On globalThis because the in-process turn and the harness MCP
// route can load this module in separate graphs.
const DRIVERS_KEY = Symbol.for("screenplay.hostedAgentFrameDrivers")
type DriversHost = typeof globalThis & {
  [DRIVERS_KEY]?: Map<string, AgentFrameDriver>
}

/**
 * The agent's driver on hosted (#1396): it drives a frame's one shared
 * browser, under the frame's one Frame Control record, so everyone watching
 * sees it and anyone can take over.
 */
export function hostedAgentDriver(room: RoomDoc): AgentFrameDriver {
  const host = globalThis as DriversHost
  const drivers = (host[DRIVERS_KEY] ??= new Map())
  let driver = drivers.get(room.roomId)
  if (!driver) {
    driver = new AgentFrameDriver({
      backend: hostedFrameDriveBackend({
        frame: (frameId) => sharedFrame(room, frameId),
        unreachable: (stream) => forgetStream(stream.url),
      }),
      store: roomFrameControlStore(room, { live: true }),
      keyOf: (frameId) => frameControlKey(frameId, "", true),
      // The server doesn't see awareness: hand the frame to whoever waits
      // first, and the canvas passes it on if they've gone.
      presence: () => ({ online: EVERYONE, goneAt: new Map() }),
    })
    drivers.set(room.roomId, driver)
  }
  return driver
}

/**
 * A hosted chat's driver: a frame goes to its shared browser, a Mockup to the
 * asker's own view (#1391), or to its shared browser while it's live (#1523). Showing either brings it into the asker's view
 * (#1390), which only their canvas can do.
 */
export function hostedChatDriver(room: RoomDoc, userId: string): FrameDriver {
  return routeChatDriver({
    shared: hostedAgentDriver(room),
    mockups: viewAgentDriver(room, userId),
    isMockup: (id) => room.readDoc((c) => c.mockupLayers.get(id) !== undefined),
    isLiveMockup: (id) =>
      room.readDoc((c) => c.mockupLayers.get(id)?.live === true),
    canvas: viewCanvasOf(room, userId),
  })
}

/** Every party counts as online. */
class Everyone extends Set<string> {
  override has(): boolean {
    return true
  }
}
const EVERYONE: ReadonlySet<string> = new Everyone()

async function sharedFrame(
  room: RoomDoc,
  frameId: string
): Promise<HostedFrame | string> {
  const mockup = await liveMockup(room, frameId)
  if (mockup) return mockup
  const found = await room.readDoc((c) => {
    const layer = c.iframeLayers.get(frameId)
    const branch = layer?.branchId ? c.branches.get(layer.branchId) : undefined
    return { layer, branch }
  })
  const { layer, branch } = found
  if (!layer) return "The frame isn’t on the canvas anymore."
  if (!branch) {
    return "The frame shows no chat’s code, so there’s no shared browser to use."
  }
  if (!branch.previewDomain) {
    return "The chat’s preview isn’t running, so its frame has nothing to show."
  }
  const stream = await workspaceStream(branch.sandboxName, branch.port)
  if (typeof stream === "string") return stream
  return {
    route: layer.route || "/",
    width: Math.round(layer.width),
    height: Math.round(layer.height),
    stream,
  }
}

/**
 * A live Mockup's page (#1523), in the Workspace it went live in: the agent
 * drives the same browser everyone sees. Null for anything else.
 */
async function liveMockup(
  room: RoomDoc,
  mockupId: string
): Promise<HostedFrame | string | null> {
  const found = await room.readDoc((c) => {
    const layer = c.mockupLayers.get(mockupId)
    if (!layer?.live) return null
    const branch = layer.liveBranchId
      ? c.branches.get(layer.liveBranchId)
      : undefined
    const html = mockupHtml(c.doc, layer.fileId ?? mockupId).toString()
    return { layer, branch, html }
  })
  if (!found) return null
  const { layer, branch, html } = found
  if (!branch?.previewDomain) {
    return "The chat this live mockup runs in has stopped, so there’s no shared browser to use."
  }
  const stream = await workspaceStream(branch.sandboxName, branch.port)
  if (typeof stream === "string") return stream
  // Its `skill:` and `files:` references (#1643) resolve as a viewer's
  // canvas resolves them, but with no one's Account Skills.
  const resources = await liveMockupRefs(room, mockupId, mockupRefs(html))
  return {
    route: "/",
    width: Math.round(layer.width),
    height: Math.round(layer.height),
    doc: mockupSrcDoc(html, MOCKUP_RUNTIME_JS, resources),
    stream,
  }
}

// A live Mockup's resolved references, briefly: the agent's every step
// sends the page, and a Repo Skill read runs a command in the Sandbox.
const REFS_KEEP_MS = 30_000
const REFS_KEY = Symbol.for("screenplay.hostedLiveMockupRefs")
type RefsHost = typeof globalThis & {
  [REFS_KEY]?: Map<string, { at: number; resources: MockupResources }>
}

async function liveMockupRefs(
  room: RoomDoc,
  mockupId: string,
  refs: string[]
): Promise<MockupResources> {
  if (refs.length === 0) return {}
  const kept = ((globalThis as RefsHost)[REFS_KEY] ??= new Map())
  const key = [room.roomId, mockupId, ...refs].join("\n")
  const hit = kept.get(key)
  if (hit && Date.now() - hit.at < REFS_KEEP_MS) return hit.resources
  for (const [k, v] of kept) {
    if (Date.now() - v.at >= REFS_KEEP_MS) kept.delete(k)
  }
  const resources = await resolveMockupRefs(
    refs,
    await mockupRefSources(room, { mockupId })
  )
  kept.set(key, { at: Date.now(), resources })
  return resources
}

// Each Workspace's stream, once its service is known to run: checking means
// running a command in the Sandbox, too slow for every step. A failure isn't
// kept, so the next step checks again.
const STREAM_CHECK_MS = 60_000
const STREAMS_KEY = Symbol.for("screenplay.hostedFrameDriveStreams")
type StreamsHost = typeof globalThis & {
  [STREAMS_KEY]?: Map<string, { url: string; key: string; at: number }>
}

function forgetStream(url: string): void {
  const streams = (globalThis as StreamsHost)[STREAMS_KEY]
  for (const [name, stream] of streams ?? [])
    if (stream.url === url) streams!.delete(name)
}

async function workspaceStream(
  sandboxName: string,
  devPort: number
): Promise<HostedFrame["stream"] | string> {
  const host = globalThis as StreamsHost
  const streams = (host[STREAMS_KEY] ??= new Map())
  const cached = streams.get(sandboxName)
  if (cached && Date.now() - cached.at < STREAM_CHECK_MS) return cached
  const result = await ensureFrameStream(sandboxName, devPort)
  if (!result.success) {
    streams.delete(sandboxName)
    return `The chat’s shared browser didn’t start: ${result.error}`
  }
  if (!result.value) {
    return "This chat was set up before frames were shared, so its frames can’t be used here."
  }
  const stream = {
    url: result.value.internalUrl,
    key: frameStreamKey(sandboxName),
    at: Date.now(),
  }
  streams.set(sandboxName, stream)
  return stream
}
