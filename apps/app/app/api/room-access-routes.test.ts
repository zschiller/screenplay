import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  HOSTED_MIGRATIONS,
  setupSharedPgliteDb,
  type SharedPgliteDb,
} from "@/test/pglite"

// Room Access on the agent turn, naming, heal and Branch-create routes (#904,
// #906), against real
// SQL: the hosted migrations on PGlite supply `room_member` and `agent_chat`.
// The session is faked, and every side effect a route can reach (launch,
// broadcast, run state, the room doc, the create lock) is a spy, so a
// rejection can assert that none of them ran.
const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: async () => session.userId,
  getGitHubToken: async () => "gh-token",
  getGitHubTokenForUser: async () => null,
}))

const fx = vi.hoisted(() => ({
  launchTurn: vi.fn(async () => ({ kind: "launched", runId: "run-1" })),
  broadcastSignal: vi.fn(async (..._args: unknown[]) => {}),
  broadcastControl: vi.fn(async () => {}),
  transition: vi.fn(async () => {}),
  startRun: vi.fn(async () => "run-1"),
  resolvePlanGate: vi.fn(async () => null),
  acquireLock: vi.fn(async () => ({ release: async () => {} })),
  after: vi.fn(),
  mutateDoc: vi.fn(async () => {}),
  readDoc: vi.fn(async () => null),
  runOneShotModel: vi.fn(async () => null),
}))

vi.mock("@/lib/agent/turn-launch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/turn-launch")>()),
  launchTurn: fx.launchTurn,
}))
vi.mock("@/lib/agent/turn-launch-live", async () => {
  const { findActiveRun } = await import("@/lib/agent/persistence")
  return {
    liveTurnLaunchDeps: () => ({}),
    liveTurnStopDeps: {
      findActiveRun,
      transition: fx.transition,
      broadcastControl: fx.broadcastControl,
      broadcastStreamEnd: (roomId: string, chatId: string) =>
        fx.broadcastSignal(roomId, chatId, "chat-stream-end"),
    },
    markdownLayerTurn: () => ({}),
    sandboxTurn: () => ({}),
  }
})
vi.mock("@/lib/agent/broadcast", () => ({
  broadcastSignal: fx.broadcastSignal,
  broadcastControl: fx.broadcastControl,
}))
vi.mock("@/lib/agent/run-state", () => ({
  transition: fx.transition,
  startRun: fx.startRun,
}))
vi.mock("@/lib/agent/acp/resolution", () => ({
  resolvePlanGate: fx.resolvePlanGate,
}))
vi.mock("@/lib/agent/acp/consumer-live", () => ({
  livePlanResolutionPorts: () => ({}),
}))
vi.mock("@/lib/agent/acp/resolve-live-engine", () => ({
  resolveLiveEngine: async () => ({}),
}))
vi.mock("@/lib/agent/launch-turn", () => ({ launchEngineTurn: vi.fn() }))
vi.mock("@/lib/agent/comment-request", () => ({
  settleCommentRequest: vi.fn(),
}))
vi.mock("@/lib/agent/toolset", () => ({ toolsetFor: () => ({}) }))
vi.mock("@/lib/agent/one-shot-model", () => ({
  runOneShotModel: fx.runOneShotModel,
}))
vi.mock("@/lib/kv", () => ({ kv: { acquireLock: fx.acquireLock } }))
vi.mock("@/lib/sandbox/provisioning", () => ({ provisionSandbox: vi.fn() }))
vi.mock("@/lib/sandbox/inspect", () => ({ crawlRoutes: vi.fn() }))
vi.mock("@/lib/yjs-host", () => ({
  yjsHost: { mutateDoc: fx.mutateDoc, readDoc: fx.readDoc },
}))
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: fx.after,
}))

const ROOM = "room-1"
const OTHER_ROOM = "room-2"

let harness: SharedPgliteDb
beforeAll(async () => {
  harness = await setupSharedPgliteDb({ migrationsFolder: HOSTED_MIGRATIONS })
}, 30000)
afterAll(async () => {
  await harness.close()
})
beforeEach(async () => {
  await harness.reset()
  vi.clearAllMocks()
  session.userId = null

  const { db, schema } = await import("@/lib/db")
  await db.insert(schema.user).values([
    { id: "member", name: "Member", email: "member@example.com" },
    { id: "outsider", name: "Outsider", email: "outsider@example.com" },
  ])
  await db.insert(schema.room).values([
    { id: ROOM, name: "R", ownerId: "member" },
    { id: OTHER_ROOM, name: "Other", ownerId: "outsider" },
  ])
  await db.insert(schema.roomMember).values([
    { roomId: ROOM, userId: "member", role: "owner" },
    { roomId: OTHER_ROOM, userId: "outsider", role: "owner" },
  ])
  await db.insert(schema.agentChat).values([
    {
      id: "chat-1",
      roomId: ROOM,
      sandboxName: "sb",
      model: "m",
      systemPrompt: "",
    },
    {
      id: "chat-other",
      roomId: OTHER_ROOM,
      sandboxName: "sb2",
      model: "m",
      systemPrompt: "",
    },
  ])
})

const post = (body: unknown) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const streamBody = {
  roomId: ROOM,
  chatId: "chat-1",
  sandboxName: "sb",
  message: "hi",
}
const planBody = { roomId: ROOM, chatId: "chat-1", planId: "p", approved: true }
const stopBody = { roomId: ROOM, chatId: "chat-1" }
const namesBody = { roomId: ROOM, prompts: ["fix the login button"] }
const branchBody = {
  flow: "new",
  roomId: ROOM,
  branchId: "b1",
  sandboxName: "sb",
  branch: "feat",
  repoId: "r1",
}

const routes = {
  stream: async (body: unknown) =>
    (await import("./agent/stream/route")).POST(post(body)),
  plan: async (body: unknown) =>
    (await import("./agent/plan/route")).POST(post(body)),
  stop: async (body: unknown) =>
    (await import("./agent/stop/route")).POST(post(body)),
  history: async (chatId: string) =>
    (await import("./agent/history/route")).GET(
      new Request(`http://test/api/agent/history?chatId=${chatId}`)
    ),
  branchCreate: async (body: unknown) =>
    (await import("./branch/create/route")).POST(post(body)),
  heal: async (body: unknown) =>
    (await import("./branch/heal/route")).POST(post(body)),
  generateNames: async (body: unknown) =>
    (await import("./agent/generate-names/route")).POST(post(body)),
}

function expectNoSideEffects() {
  expect(fx.launchTurn).not.toHaveBeenCalled()
  expect(fx.broadcastSignal).not.toHaveBeenCalled()
  expect(fx.broadcastControl).not.toHaveBeenCalled()
  expect(fx.transition).not.toHaveBeenCalled()
  expect(fx.startRun).not.toHaveBeenCalled()
  expect(fx.resolvePlanGate).not.toHaveBeenCalled()
  expect(fx.acquireLock).not.toHaveBeenCalled()
  expect(fx.after).not.toHaveBeenCalled()
  expect(fx.mutateDoc).not.toHaveBeenCalled()
  expect(fx.readDoc).not.toHaveBeenCalled()
  expect(fx.runOneShotModel).not.toHaveBeenCalled()
}

describe("a signed-in non-member gets a 403 and nothing runs", () => {
  beforeEach(() => {
    session.userId = "outsider"
  })

  it("starting a turn", async () => {
    expect((await routes.stream(streamBody)).status).toBe(403)
    expectNoSideEffects()
  })

  it("resuming a plan", async () => {
    expect((await routes.plan(planBody)).status).toBe(403)
    expectNoSideEffects()
  })

  it("stopping a turn", async () => {
    expect((await routes.stop(stopBody)).status).toBe(403)
    expectNoSideEffects()
  })

  it("reading a chat's history", async () => {
    expect((await routes.history("chat-1")).status).toBe(403)
  })

  it("healing a chat's stream", async () => {
    expect((await routes.heal(stopBody)).status).toBe(403)
    expectNoSideEffects()
  })

  it("naming Branches", async () => {
    expect((await routes.generateNames(namesBody)).status).toBe(403)
    expectNoSideEffects()
  })

  it("creating a Branch", async () => {
    const res = await routes.branchCreate(branchBody)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "You don't have access to this project",
    })
    expectNoSideEffects()
  })
})

describe("a member can't reach another Room's chat through their own Room", () => {
  beforeEach(() => {
    session.userId = "member"
  })

  it.each([
    ["stream", () => routes.stream({ ...streamBody, chatId: "chat-other" })],
    ["plan", () => routes.plan({ ...planBody, chatId: "chat-other" })],
    ["stop", () => routes.stop({ ...stopBody, chatId: "chat-other" })],
    ["heal", () => routes.heal({ ...stopBody, chatId: "chat-other" })],
    ["history", () => routes.history("chat-other")],
  ])("%s", async (_, call) => {
    expect((await call()).status).toBe(403)
    expectNoSideEffects()
  })
})

it("no session gets a 401", async () => {
  expect((await routes.stop(stopBody)).status).toBe(401)
  expect((await routes.branchCreate(branchBody)).status).toBe(401)
  expect((await routes.heal(stopBody)).status).toBe(401)
  expect((await routes.generateNames(namesBody)).status).toBe(401)
  expectNoSideEffects()
})

describe("a member is let through", () => {
  beforeEach(() => {
    session.userId = "member"
  })

  it("starts a turn", async () => {
    const res = await routes.stream(streamBody)
    expect(await res.json()).toEqual({ chatId: "chat-1", runId: "run-1" })
    expect(fx.launchTurn).toHaveBeenCalledOnce()
  })

  it("starts a turn in a chat no turn has recorded yet", async () => {
    const res = await routes.stream({ ...streamBody, chatId: "chat-new" })
    expect(res.status).toBe(200)
    expect(fx.launchTurn).toHaveBeenCalledOnce()
  })

  it("stops a turn", async () => {
    expect((await routes.stop(stopBody)).status).toBe(200)
    expect(fx.broadcastSignal).toHaveBeenCalledWith(
      ROOM,
      "chat-1",
      "chat-stream-end"
    )
  })

  it("heals a chat's stream", async () => {
    expect((await routes.heal(stopBody)).status).toBe(200)
    expect(fx.broadcastSignal).toHaveBeenCalledWith(
      ROOM,
      "chat-1",
      "chat-stream-end"
    )
  })

  it("names Branches", async () => {
    const res = await routes.generateNames(namesBody)
    expect(res.status).toBe(200)
    expect(fx.readDoc).toHaveBeenCalledOnce()
  })

  it("reads a chat's history", async () => {
    const res = await routes.history("chat-1")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("creates a Branch", async () => {
    expect((await routes.branchCreate(branchBody)).status).toBe(200)
    expect(fx.acquireLock).toHaveBeenCalledWith("branch-create:b1", 300)
    expect(fx.after).toHaveBeenCalledOnce()
  })
})
