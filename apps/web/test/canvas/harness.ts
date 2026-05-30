import * as Y from "yjs"
import { createCanvasOps, type CanvasOps } from "@/lib/canvas/ops"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import type {
  AgentData,
  ChatSessionData,
  GroupMember,
  IframeLayerData,
  MarkdownLayerData,
  WorkspaceData,
} from "@/lib/types"

/**
 * Bare-`Y.Doc` harness for the Canvas Operations seam. Builds a real room
 * Y.Doc, its {@link RoomCollections}, and a {@link CanvasOps} with no React and
 * no Liveblocks — the whole point of the seam is that mutation logic runs
 * against a plain document. Slices 3–5 (#158–#160) reuse this and the
 * invariant sweep below.
 */
export function makeHarness(): {
  doc: Y.Doc
  collections: RoomCollections
  ops: CanvasOps
} {
  const doc = new Y.Doc()
  const collections = getRoomCollections(doc)
  const ops = createCanvasOps(collections)
  return { doc, collections, ops }
}

/** A minimal valid Iframe Layer record for seeding. */
export function baseLayer(
  id: string,
  overrides: Partial<IframeLayerData> = {},
): IframeLayerData {
  return { id, width: 400, height: 300, label: "Frame", iframeState: {}, ...overrides }
}

/** A minimal valid Agent record for seeding cascade-removal tests. */
export function baseAgent(
  id: string,
  overrides: Partial<AgentData> = {},
): AgentData {
  return {
    id,
    workspaceId: "workspace-1",
    sandboxName: `sandbox-${id}`,
    gitUrl: "https://example.com/repo.git",
    branch: "main",
    previewDomain: "",
    port: 3000,
    status: "running",
    createdAt: 0,
    ...overrides,
  }
}

/** A minimal valid Markdown Layer (Document) record for seeding. */
export function baseDoc(
  id: string,
  overrides: Partial<MarkdownLayerData> = {},
): MarkdownLayerData {
  return { id, width: 300, height: 200, title: "", ...overrides }
}

/** A minimal valid Chat Session record. Pass `agentId` or `markdownLayerId` to set its target. */
export function baseChat(
  id: string,
  overrides: Partial<ChatSessionData> = {},
): ChatSessionData {
  return { id, label: "Chat", createdAt: 0, ...overrides }
}

/** A minimal valid Workspace record for seeding cascade-removal tests. */
export function baseWorkspace(
  id: string,
  overrides: Partial<WorkspaceData> = {},
): WorkspaceData {
  return {
    id,
    name: id,
    repoFullName: "owner/repo",
    repoOwner: "owner",
    repoName: "repo",
    defaultBranch: "main",
    cloneUrl: "https://example.com/repo.git",
    setupScript: "",
    devScript: "",
    devServerPort: 3000,
    envVars: "",
    createdAt: 0,
    ...overrides,
  }
}

/** Seed a Group holding `members`, anchored at the origin. */
export function seedGroup(
  collections: RoomCollections,
  id: string,
  members: GroupMember[],
): void {
  collections.iframeLayerGroups.set(id, { id, name: id, x: 0, y: 0, members })
}

/**
 * Reusable invariant sweep: the ids of every *committed* Group that holds zero
 * Members. The Group invariant (CONTEXT.md) says this set is always empty
 * outside an open transaction, so tests assert `findEmptyGroups(...)` is `[]`
 * after any verb.
 */
export function findEmptyGroups(collections: RoomCollections): string[] {
  return collections.iframeLayerGroups
    .toArray()
    .filter((g) => (g.members?.length ?? 0) === 0)
    .map((g) => g.id)
}
