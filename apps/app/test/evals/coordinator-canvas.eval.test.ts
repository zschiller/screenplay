/**
 * Coordinator canvas eval: real model, real prompt, real tools, a fixture
 * canvas. Skipped unless COORD_EVAL=1 (needs a model key, e.g.
 * ANTHROPIC_API_KEY). Each ask starts from the same messy canvas; results go
 * to $COORD_EVAL_OUT (default .coord-eval/) as one JSON per ask.
 *
 *   COORD_EVAL=1 pnpm vitest run test/evals/coordinator-canvas.eval.test.ts
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "vitest"
import * as Y from "yjs"
import { generateText, stepCountIs } from "ai"

import { buildRoomSystemPrompt } from "@/lib/agent/config"
import {
  buildRoomTools,
  summarizeCanvas,
  type RoomToolPorts,
} from "@/lib/agent/room-tools"
import { DEFAULT_MODEL, resolveLanguageModel } from "@/lib/agent/providers"
import { getSkillIndex } from "@/lib/skills"
import { computeIframeLayerLayouts, groupContentHeight, groupContentWidth } from "@/lib/canvas/layout"
import { createRoomCollections, getRoomCollections } from "@/lib/yjs/schema"
import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  RepoData,
} from "@/lib/types"

const RUN = process.env.COORD_EVAL === "1"
const OUT = process.env.COORD_EVAL_OUT ?? ".coord-eval"
const MODEL = process.env.COORD_EVAL_MODEL ?? DEFAULT_MODEL
const ONLY = process.env.COORD_EVAL_ONLY?.split(",")

export const ASKS: Record<string, string> = {
  tidy: "Tidy up the canvas.",
  variants:
    "Put the three checkout variants side by side so I can compare them.",
  mobile: "Put all the phone-sized frames together in one group.",
  brief: "Move the Checkout brief next to the Checkout polish frames.",
  overlap: "Some things are overlapping on the canvas. Can you fix that?",
  column:
    "Stack the groups in one column, Checkout polish at the top, then the variants, then everything else.",
  zoomCart: "Zoom to the empty cart frame.",
  fit: "Zoom out so I can see everything.",
  focusVariantB: "Take me to the split screen variant.",
  removeAndShow: "Remove the blank frame and then show me the cart.",
}

const now = Date.UTC(2026, 8, 30, 12)
const repoId = "repo-storefront"

function branch(
  id: string,
  title: string,
  ref: string,
  extra: Partial<BranchData> = {}
): BranchData {
  return {
    id,
    repoId,
    sandboxName: ref,
    gitUrl: "https://github.com/acme/storefront.git",
    ref,
    title,
    previewDomain: `${ref}.preview.test`,
    port: 3000,
    status: "running",
    createdAt: now - 60_000,
    lastActivityAt: now - 60_000,
    colorIndex: 0,
    sidebarOrder: 0,
    ...extra,
  } as BranchData
}

function frame(
  id: string,
  label: string,
  branchId: string | undefined,
  route: string | undefined,
  size: "desktop" | "phone"
): IframeLayerData {
  return {
    id,
    label,
    ...(branchId ? { branchId } : {}),
    ...(route ? { route } : {}),
    width: size === "desktop" ? 1280 : 402,
    height: size === "desktop" ? 800 : 874,
    iframeState: {},
  } as IframeLayerData
}

function group(
  id: string,
  name: string,
  x: number,
  y: number,
  members: Array<[kind: "iframe-layer" | "markdown-layer", id: string]>
): IframeLayerGroupData {
  return {
    id,
    name,
    x,
    y,
    members: members.map(([kind, id]) => ({ kind, id })),
  } as IframeLayerGroupData
}

/**
 * A canvas that grew by hand: the variants landed wherever, the brief is far
 * off, a blank frame was never used, and two Groups overlap.
 */
export function messyCanvas() {
  const repo = {
    id: repoId,
    name: "storefront",
    repoFullName: "acme/storefront",
    repoOwner: "acme",
    repoName: "storefront",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/storefront.git",
    createdAt: now - 86_400_000,
    sidebarOrder: 0,
  } as RepoData
  const branches = [
    branch("ws-polish", "Checkout polish", "checkout-polish"),
    branch("ws-cart", "Empty cart state", "empty-cart-state"),
    branch("ws-a", "Checkout: single column", "checkout-single-column"),
    branch("ws-b", "Checkout: split screen", "checkout-split-screen"),
    branch("ws-c", "Checkout: accordion", "checkout-accordion"),
  ]
  const iframeLayers = [
    frame("f-polish-desk", "Checkout · desktop", "ws-polish", "/checkout", "desktop"),
    frame("f-polish-phone", "Checkout · iPhone 17 Pro", "ws-polish", "/checkout", "phone"),
    frame("f-cart", "Empty cart", "ws-cart", "/cart", "desktop"),
    frame("f-blank", "Frame", undefined, undefined, "desktop"),
    frame("f-a-desk", "Checkout", "ws-a", "/checkout", "desktop"),
    frame("f-a-phone", "Checkout · phone", "ws-a", "/checkout", "phone"),
    frame("f-b-desk", "Checkout", "ws-b", "/checkout", "desktop"),
    frame("f-c-desk", "Checkout", "ws-c", "/checkout", "desktop"),
  ]
  const markdownLayers = [
    { id: "doc-brief", title: "Checkout brief", width: 720, height: 800 },
  ] as MarkdownLayerData[]
  const iframeLayerGroups = [
    group("g-polish", "Checkout polish", 0, 0, [
      ["iframe-layer", "f-polish-desk"],
      ["iframe-layer", "f-polish-phone"],
    ]),
    // Overlaps Checkout polish's phone frame.
    group("g-cart", "Empty cart state", 1500, 300, [["iframe-layer", "f-cart"]]),
    group("g-blank", "Group 3", 400, 1150, [["iframe-layer", "f-blank"]]),
    group("g-a", "Checkout: single column", 2300, 2200, [
      ["iframe-layer", "f-a-desk"],
      ["iframe-layer", "f-a-phone"],
    ]),
    group("g-b", "Checkout: split screen", -1900, 2600, [["iframe-layer", "f-b-desk"]]),
    group("g-c", "Checkout: accordion", 3600, 700, [["iframe-layer", "f-c-desk"]]),
    group("g-brief", "Group 7", 6200, -900, [["markdown-layer", "doc-brief"]]),
  ]
  return { repos: [repo], branches, iframeLayers, markdownLayers, iframeLayerGroups }
}

function seed(doc: Y.Doc) {
  const c = getRoomCollections(doc)
  const w = messyCanvas()
  c.transact(() => {
    for (const r of w.repos) c.repos.set(r.id, r)
    for (const b of w.branches) c.branches.set(b.id, b)
    for (const f of w.iframeLayers) c.iframeLayers.set(f.id, f)
    for (const d of w.markdownLayers) c.markdownLayers.set(d.id, d)
    for (const g of w.iframeLayerGroups) c.iframeLayerGroups.set(g.id, g)
  })
}

function ports(doc: Y.Doc): RoomToolPorts {
  const no = (what: string) => async (): Promise<never> => {
    throw new Error(`${what} isn't available in this eval.`)
  }
  return {
    readDoc: async (fn) => fn(createRoomCollections(doc)),
    mutateDoc: async (fn) => fn(createRoomCollections(doc)),
    listTerminalTabs: async () => [],
    provisionWorkspace: no("Starting Workspaces"),
    stopWorkspaceTurn: no("Stopping Workspaces"),
    openPullRequest: no("Opening pull requests"),
    deleteSandbox: no("Removing Workspaces"),
    requesterId: "user-1",
    coordinatorChatId: "room-chat-1",
    readChatTranscript: async () => [],
    readWorkspaceDiff: async () => "",
    readWorkspaceFile: async () => null,
    captureFrame: no("Frame screenshots"),
    readFrameCapture: async () => null,
    launchWorkspaceTurn: no("Messaging Workspaces"),
  } as RoomToolPorts
}

/** Group rects, and every pair of Groups whose rects intersect. */
export function layoutReport(doc: Y.Doc) {
  const c = createRoomCollections(doc)
  const groups = Object.values(doc.getMap("iframeLayerGroups").toJSON()) as IframeLayerGroupData[]
  const frames = Object.values(doc.getMap("iframeLayers").toJSON()) as IframeLayerData[]
  const docs = Object.values(doc.getMap("markdownLayers").toJSON()) as MarkdownLayerData[]
  void c
  const rects = groups.map((g) => ({
    id: g.id,
    name: g.name,
    x: g.x,
    y: g.y,
    w: groupContentWidth(g, frames, docs),
    h: groupContentHeight(g, frames, docs),
    members: g.members.map((m) => m.id),
  }))
  const overlaps: string[] = []
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        overlaps.push(`${a.name} × ${b.name}`)
    }
  const layouts = Object.fromEntries(computeIframeLayerLayouts(groups, frames, docs))
  return { rects, overlaps, layouts, groups, frames, docs }
}

describe.skipIf(!RUN)("Coordinator canvas eval", () => {
  mkdirSync(OUT, { recursive: true })
  const before = new Y.Doc()
  seed(before)
  writeFileSync(join(OUT, "before.json"), JSON.stringify(layoutReport(before), null, 2))

  for (const [key, ask] of Object.entries(ASKS)) {
    if (ONLY && !ONLY.includes(key)) continue
    it(key, { timeout: 300_000 }, async () => {
      const doc = new Y.Doc()
      seed(doc)
      const p = ports(doc)
      const system = buildRoomSystemPrompt({
        canvasSummary: await p.readDoc((c) => summarizeCanvas(c)),
        skills: getSkillIndex("coordinator"),
      })
      const result = await generateText({
        model: resolveLanguageModel(MODEL),
        system,
        messages: [{ role: "user", content: ask }],
        tools: buildRoomTools("room-eval", p),
        stopWhen: stepCountIs(25),
      })
      const calls = result.steps.flatMap((s) =>
        s.toolCalls.map((call) => ({
          tool: call.toolName,
          input: call.input,
          output: s.toolResults.find((r) => r.toolCallId === call.toolCallId)?.output,
        }))
      )
      const report = { key, ask, model: MODEL, text: result.text, calls, after: layoutReport(doc) }
      writeFileSync(join(OUT, `${key}.json`), JSON.stringify(report, null, 2))
      if (key === "tidy") writeFileSync(join(OUT, "system-prompt.txt"), system)
    })
  }
})
