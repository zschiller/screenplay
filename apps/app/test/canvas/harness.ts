import * as Y from "yjs"
import { createCanvasOps, type CanvasOps } from "@/lib/canvas/ops"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import type {
  BranchData,
  ChatSessionData,
  GroupMember,
  IframeLayerData,
  MarkdownLayerData,
  RepoData,
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
  // Mirror production: React always subscribes to every collection, which is
  // what attaches each `YjsCollection`'s `observeDeep` listener and so
  // invalidates its `toArray()`/`toMap()` snapshot cache after each
  // transaction. Without a subscriber, a verb's own internal `toArray()` read
  // would poison the cache with a pre-mutation snapshot and mask later writes.
  for (const value of Object.values(collections)) {
    if (
      value &&
      typeof (value as { observe?: unknown }).observe === "function"
    ) {
      ;(value as { observe(cb: () => void): () => void }).observe(() => {})
    }
  }
  const ops = createCanvasOps(collections)
  return { doc, collections, ops }
}

/** A minimal valid Iframe Layer record for seeding. */
export function baseLayer(
  id: string,
  overrides: Partial<IframeLayerData> = {}
): IframeLayerData {
  return {
    id,
    width: 400,
    height: 300,
    label: "Frame",
    iframeState: {},
    ...overrides,
  }
}

/** A minimal valid Branch record for seeding cascade-removal tests. */
export function baseBranch(
  id: string,
  overrides: Partial<BranchData> = {}
): BranchData {
  return {
    id,
    repoId: "repo-1",
    sandboxName: `sandbox-${id}`,
    gitUrl: "https://example.com/repo.git",
    ref: "main",
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
  overrides: Partial<MarkdownLayerData> = {}
): MarkdownLayerData {
  return { id, width: 300, height: 200, title: "", ...overrides }
}

/** A minimal valid Chat Session record. Pass `branchId` or `markdownLayerId` to set its target. */
export function baseChat(
  id: string,
  overrides: Partial<ChatSessionData> = {}
): ChatSessionData {
  return { id, label: "Chat", createdAt: 0, ...overrides }
}

/** A minimal valid Repo record for seeding cascade-removal tests. */
export function baseRepo(
  id: string,
  overrides: Partial<RepoData> = {}
): RepoData {
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
  members: GroupMember[]
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
