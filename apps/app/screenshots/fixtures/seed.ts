import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import * as Y from "yjs"

import { computeIframeLayerLayouts } from "@/lib/canvas/layout"
import { createPgliteDb } from "@/lib/db/pglite"
import * as schema from "@/lib/db/schema"
import type { DB } from "@/lib/db/types"
import { encrypt } from "@/lib/crypto"
import { LOCAL_USER } from "@/lib/local-user"
import {
  buildThumbnailManifest,
  type FrameCapture,
  type ManifestLayer,
} from "@/lib/thumbnail/manifest"
import {
  documentFragment,
  writeMarkdownToFragment,
} from "@/lib/yjs/fragment-text"
import { getRoomCollections } from "@/lib/yjs/schema"

import type { CaptureProfile } from "../profile"
import { renderFrameCaptures, type FrameCaptureRequest } from "./frame-captures"
import { buildFixtureWorld, type FixtureRoom, type FixtureWorld } from "./world"

/**
 * The **seeder** — the single writer that turns the Fixture World (`./world.ts`)
 * into the three stores the local build reads from:
 *
 *  1. **PGlite** — `user`, `folder`, `room`, `room_folder`, `pin`,
 *     `terminal_tab`, `agent_chat`/`agent_message`, and the encrypted
 *     `kv_store` row holding the Project presets.
 *  2. **The Yjs host's persistence dir** — one `<roomId>.ydoc` per Canvas,
 *     holding the Repos, Workspaces, Layers, Groups, chats, and plans.
 *  3. **The local-fs blob dir** — synthetic Frame Captures, so the home grid
 *     composes real cards.
 *
 * It runs as its **own process, before the app server boots**, and that ordering
 * is load-bearing rather than incidental: PGlite refuses a second concurrent
 * opener of a data dir (`lib/db/pglite.ts` — two writers corrupt it
 * irrecoverably), so the seeder opens the dir, migrates, writes, and closes
 * *before* anything else claims it. Writing the Y.Docs straight to disk instead
 * of over a WebSocket falls out of the same constraint, and is simpler: the host
 * loads whatever state it finds on first bind.
 *
 * Re-running is safe. `--fresh` (the default for `boot`) deletes the whole state
 * dir first; without it, every write is an upsert, so re-seeding an existing dir
 * restores the world without duplicating it.
 */

export interface SeedOptions {
  /**
   * Delete the existing database, Y.Docs, and blobs first. A capture run wants
   * this — a world that has been clicked around in isn't the world the fixtures
   * describe, and a before/after pair has to start from the same state twice.
   */
  fresh?: boolean
  /** Where progress is reported. Defaults to stdout. */
  log?: (message: string) => void
}

export interface SeedResult {
  world: FixtureWorld
  rooms: number
  folders: number
  captures: number
}

export async function seedFixtureWorld(
  profile: CaptureProfile,
  options: SeedOptions = {}
): Promise<SeedResult> {
  const log = options.log ?? ((m: string) => console.log(m))
  const pgliteDir = profile.env.PGLITE_DATA_DIR!
  const yjsDir = profile.env.YJS_PERSISTENCE_DIR!
  const blobDir = profile.env.LOCAL_BLOB_DIR!
  const blobBaseUrl = profile.env.LOCAL_BLOB_BASE_URL!

  if (options.fresh) {
    log("• wiping previous fixture state")
    // The `.lock` sibling has to go with the data dir: left behind by a
    // hard-killed server it names a pid that may since have been reused, and the
    // dir it guards no longer exists.
    await Promise.all([
      rm(pgliteDir, { recursive: true, force: true }),
      rm(`${pgliteDir}.lock`, { force: true }),
      rm(yjsDir, { recursive: true, force: true }),
      rm(blobDir, { recursive: true, force: true }),
    ])
  }

  const world = buildFixtureWorld({ previewOrigin: profile.previewOrigin })

  // Encrypting the Project presets needs the profile's minted ENCRYPTION_KEY,
  // and `lib/crypto` reads it off `process.env` at first use — this process was
  // not necessarily launched with it, so apply the profile env here.
  Object.assign(process.env, profile.env)

  log(`• opening PGlite at ${pgliteDir}`)
  const handle = createPgliteDb(pgliteDir)
  try {
    await handle.ready
    await seedDatabase(handle.db, world)
    log(
      `• seeded ${world.rooms.length} canvases, ${world.folders.length} folders`
    )

    const captures = await seedRoomDocs(world, {
      yjsDir,
      blobDir,
      blobBaseUrl,
      db: handle.db,
    })
    log(`• wrote ${world.rooms.length} Y.Docs and ${captures} frame captures`)

    return {
      world,
      rooms: world.rooms.length,
      folders: world.folders.length,
      captures,
    }
  } finally {
    // Release the data dir before returning so the app server can claim it.
    await handle.close()
  }
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * Write the relational half. Every statement is an upsert
 * (`onConflictDoUpdate`/`onConflictDoNothing`) so a re-seed over a live dir
 * converges rather than failing on a primary key, and so the local user this
 * shares with `instrumentation.ts`'s boot seed can be written by whichever runs
 * first.
 *
 * Insert order follows the foreign keys: user → folder → room → placement → pin,
 * and chat → message.
 */
async function seedDatabase(db: DB, world: FixtureWorld): Promise<void> {
  await db
    .insert(schema.user)
    .values({
      id: LOCAL_USER.id,
      name: LOCAL_USER.name,
      email: LOCAL_USER.email,
    })
    .onConflictDoNothing()

  // Parents before children: `folder.parentFolderId` self-references, and the
  // world lists a nested Folder after the one it hangs off.
  for (const folder of [...world.folders].sort(depthFirst(world))) {
    await db
      .insert(schema.folder)
      .values({
        id: folder.id,
        ownerId: world.userId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        createdAt: new Date(folder.createdAt),
        updatedAt: new Date(folder.createdAt),
      })
      .onConflictDoUpdate({
        target: schema.folder.id,
        set: { name: folder.name, parentFolderId: folder.parentFolderId },
      })
  }

  for (const room of world.rooms) {
    await db
      .insert(schema.room)
      .values({
        id: room.id,
        name: room.name,
        ownerId: world.userId,
        createdAt: new Date(room.createdAt),
        updatedAt: new Date(room.lastOpenedAt ?? room.createdAt),
        lastOpenedAt: room.lastOpenedAt ? new Date(room.lastOpenedAt) : null,
      })
      .onConflictDoUpdate({
        target: schema.room.id,
        set: {
          name: room.name,
          lastOpenedAt: room.lastOpenedAt ? new Date(room.lastOpenedAt) : null,
        },
      })

    if (room.folderId) {
      await db
        .insert(schema.roomFolder)
        .values({
          userId: world.userId,
          roomId: room.id,
          folderId: room.folderId,
          createdAt: new Date(room.createdAt),
          updatedAt: new Date(room.createdAt),
        })
        .onConflictDoUpdate({
          target: [schema.roomFolder.userId, schema.roomFolder.roomId],
          set: { folderId: room.folderId },
        })
    }
  }

  for (const pin of world.pins) {
    await db
      .insert(schema.pin)
      .values({
        id: pin.id,
        userId: world.userId,
        roomId: pin.roomId ?? null,
        folderId: pin.folderId ?? null,
        position: pin.position,
        createdAt: new Date(world.now),
      })
      .onConflictDoUpdate({
        target: schema.pin.id,
        set: { position: pin.position },
      })
  }

  for (const tab of world.terminalTabs) {
    await db
      .insert(schema.terminalTab)
      .values({
        id: tab.id,
        userId: world.userId,
        roomId: tab.roomId,
        branch: tab.branch,
        label: tab.label,
        harnessKey: tab.harnessKey ?? null,
        createdAt: new Date(tab.createdAt),
      })
      .onConflictDoUpdate({
        target: schema.terminalTab.id,
        set: { label: tab.label },
      })
  }

  for (const chat of world.chats) {
    await db
      .insert(schema.agentChat)
      .values({
        id: chat.id,
        roomId: chat.roomId,
        sandboxName: chat.sandboxName,
        model: chat.model,
        systemPrompt: chat.systemPrompt,
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.createdAt),
      })
      .onConflictDoUpdate({
        target: schema.agentChat.id,
        set: { model: chat.model, systemPrompt: chat.systemPrompt },
      })

    // The plan card is merged into the chat timeline by `/api/agent/history`
    // from this pending row, not rebuilt from the message log — so the run and
    // the pending call are what actually put the approve/reject card on screen.
    if (chat.pendingPlan) {
      const plan = chat.pendingPlan
      await db
        .insert(schema.agentRun)
        .values({
          id: plan.runId,
          chatId: chat.id,
          status: "paused_for_plan",
          startedAt: new Date(plan.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.agentRun.id,
          set: { status: "paused_for_plan" },
        })
      await db
        .insert(schema.agentPendingToolCall)
        .values({
          id: plan.toolCallId,
          runId: plan.runId,
          chatId: chat.id,
          toolName: "submit_plan",
          input: { plan: plan.plan },
          status: "pending",
          createdAt: new Date(plan.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.agentPendingToolCall.id,
          set: { input: { plan: plan.plan }, status: "pending" },
        })
    }

    for (const message of chat.messages) {
      await db
        .insert(schema.agentMessage)
        .values({
          id: message.id,
          chatId: chat.id,
          role: message.record.role,
          message: message.record,
          createdAt: new Date(message.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.agentMessage.id,
          set: { message: message.record },
        })
    }
  }

  // The Project presets go through `lib/crypto` under the exact key
  // `lib/repo-configs-store.ts` reads (`user-workspace-configs:<userId>`, kept
  // for back-compat). We write the row directly rather than calling
  // `saveConfigs`, because that reaches `lib/kv` → `lib/db`, which is
  // `server-only` and refuses to load outside an RSC bundle.
  await db
    .insert(schema.kvStore)
    .values({
      key: `user-workspace-configs:${world.userId}`,
      value: encrypt(JSON.stringify(world.repoConfigs)),
      expiresAt: null,
    })
    .onConflictDoUpdate({
      target: schema.kvStore.key,
      set: { value: encrypt(JSON.stringify(world.repoConfigs)) },
    })
}

/** Order Folders parents-first, so a self-referencing FK always resolves. */
function depthFirst(world: FixtureWorld) {
  const depth = (id: string | null, guard = 0): number => {
    if (!id || guard > 32) return 0
    const parent = world.folders.find((f) => f.id === id)
    return parent ? 1 + depth(parent.parentFolderId, guard + 1) : 0
  }
  return (
    a: { parentFolderId: string | null },
    b: { parentFolderId: string | null }
  ) => depth(a.parentFolderId) - depth(b.parentFolderId)
}

// ---------------------------------------------------------------------------
// Y.Docs + thumbnails
// ---------------------------------------------------------------------------

/**
 * Write one `.ydoc` per Canvas and, for the Rooms that ask for them, the
 * synthetic Frame Captures plus the Thumbnail Manifest that references them.
 *
 * The manifest is **derived, never hand-written**: rects come from
 * `computeIframeLayerLayouts` over the same groups just written to the doc, and
 * the manifest itself from the production `buildThumbnailManifest`. So a fixture
 * can't claim a thumbnail layout its canvas doesn't have — and when the app later
 * binds the doc, the host's layout watcher rebuilds the same manifest and retains
 * these captures rather than replacing them with placeholders.
 */
async function seedRoomDocs(
  world: FixtureWorld,
  ctx: { yjsDir: string; blobDir: string; blobBaseUrl: string; db: DB }
): Promise<number> {
  await mkdir(ctx.yjsDir, { recursive: true })
  let captureCount = 0

  for (const room of world.rooms) {
    const doc = new Y.Doc()
    applyRoomDoc(doc, room)

    // Match `FileYjsPersistence.fileFor`: one file per room holding the full
    // encoded state, keyed by the url-encoded room id.
    await writeFile(
      join(ctx.yjsDir, `${encodeURIComponent(room.id)}.ydoc`),
      Y.encodeStateAsUpdate(doc)
    )

    captureCount += await seedRoomThumbnail(room, ctx)
    doc.destroy()
  }

  return captureCount
}

/** Populate one Room's Y.Doc from its fixture entry. */
function applyRoomDoc(doc: Y.Doc, room: FixtureRoom): void {
  const fixture = room.doc
  if (!fixture) return
  const c = getRoomCollections(doc)

  c.transact(() => {
    for (const repo of fixture.repos ?? []) c.repos.set(repo.id, repo)
    for (const branch of fixture.branches ?? [])
      c.branches.set(branch.id, branch)
    for (const layer of fixture.iframeLayers ?? [])
      c.iframeLayers.set(layer.id, layer)
    for (const layer of fixture.markdownLayers ?? [])
      c.markdownLayers.set(layer.id, layer)
    // Groups last: the legacy-group migration in `getRoomCollections` wraps any
    // layer no group references, and writing the groups after the layers means
    // there is nothing left for it to wrap.
    for (const group of fixture.iframeLayerGroups ?? [])
      c.iframeLayerGroups.set(group.id, group)
    for (const chat of fixture.chatSessions ?? [])
      c.chatSessions.set(chat.id, chat)
    for (const plan of fixture.plans ?? []) c.plans.set(plan.id, plan)
    if (fixture.savedViewport) c.savedViewport.set(fixture.savedViewport)
  })

  // Document bodies go through the same TipTap-backed writer the agent's
  // document tools use, so the seeded XmlFragment is one the editor can mount
  // (a hand-built fragment that fails the `heading block*` schema renders blank).
  for (const [layerId, markdown] of Object.entries(
    fixture.markdownBodies ?? {}
  )) {
    writeMarkdownToFragment(documentFragment(doc, layerId), markdown)
  }
}

/** Render a Room's Frame Captures and persist the manifest they belong to. */
async function seedRoomThumbnail(
  room: FixtureRoom,
  ctx: { blobDir: string; blobBaseUrl: string; db: DB }
): Promise<number> {
  const frameIds = room.thumbnailFrames ?? []
  if (frameIds.length === 0 || !room.doc) return 0

  const groups = room.doc.iframeLayerGroups ?? []
  const iframeLayers = room.doc.iframeLayers ?? []
  const markdownLayers = room.doc.markdownLayers ?? []
  const layouts = computeIframeLayerLayouts(
    groups,
    iframeLayers,
    markdownLayers
  )
  const branchesById = new Map(
    (room.doc.branches ?? []).map((branch) => [branch.id, branch])
  )

  const requests: FrameCaptureRequest[] = []
  const manifestLayers: ManifestLayer[] = []
  for (const frameId of frameIds) {
    const layer = iframeLayers.find((l) => l.id === frameId)
    const layout = layouts.get(frameId)
    if (!layer || !layout) continue
    const branch = layer.branchId ? branchesById.get(layer.branchId) : undefined
    requests.push({
      layerId: frameId,
      width: layout.width,
      height: layout.height,
      label: layer.label,
      paletteIndex: branch?.colorIndex ?? null,
    })
    manifestLayers.push({
      id: frameId,
      label: layer.label,
      branchKey: layer.branchId ?? null,
      ...(branch?.colorIndex !== undefined
        ? { branchColorIndex: branch.colorIndex }
        : {}),
    })
  }
  if (requests.length === 0) return 0

  const rendered = await renderFrameCaptures(
    requests,
    ctx.blobDir,
    ctx.blobBaseUrl
  )
  const captures = new Map<string, FrameCapture>(
    rendered.map((capture) => [
      capture.layerId,
      {
        url: capture.url,
        // Stamped from the Room's own clock, not `Date.now()`, so "captured 4
        // minutes ago" reads the same on every seed run.
        capturedAt: room.lastOpenedAt ?? room.createdAt,
        width: capture.width,
        height: capture.height,
      },
    ])
  )

  const manifest = buildThumbnailManifest(layouts, manifestLayers, captures)
  await ctx.db
    .update(schema.room)
    .set({
      thumbnailManifest: manifest,
      thumbnailUpdatedAt: new Date(room.lastOpenedAt ?? room.createdAt),
    })
    .where(eq(schema.room.id, room.id))

  return rendered.length
}
