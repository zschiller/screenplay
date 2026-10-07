import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { eq } from "drizzle-orm"
import * as Y from "yjs"

import { computeIframeLayerLayouts } from "@/lib/canvas/layout"
import { groupsOnPage, orderedPages } from "@/lib/canvas/pages"
import { MOCKUP_INDEX, mockupFolderPrefix } from "@/lib/mockup-folder"
import { createPgliteDb } from "@/lib/db/pglite"
import * as schema from "@/lib/db/schema"
import type { DB } from "@/lib/db/types"
import { encrypt } from "@/lib/crypto"
import { canvasRepoEnvKey, envVarsDigest } from "@/lib/repo-env/encoding"
import { envVarNames } from "@/lib/repo-env/names"
import { snapshotLabel } from "@/lib/comment-anchor"
import { LOCAL_USER } from "@/lib/local-user"
import {
  buildThumbnailManifest,
  type FrameCapture,
  type ManifestLayer,
} from "@/lib/thumbnail/manifest"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { writeDocumentMarkdown } from "@/lib/document-markdown"
import { createSavedSkills } from "@/lib/skills/saved"
import { listFileIndex, memoryFileListStore } from "@/lib/files/account-files"
import { accountFileKeyPrefix } from "@/lib/files/paths"
import type { FileStore } from "@/lib/files/store"
import type { FileEntryData } from "@/lib/types"
import { COLLECTION_KEYS, getRoomCollections } from "@/lib/yjs/schema"

import type { CaptureProfile } from "../profile"
import { FIXTURE_SESSION_TOKEN } from "../lib/hosted"
import { renderFrameCaptures, type FrameCaptureRequest } from "./frame-captures"
import {
  buildFixtureWorld,
  type FileFixtureBody,
  type FixtureRoom,
  type FixtureSkill,
  type FixtureWorld,
} from "./world"

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
  /**
   * The world to seed. Defaults to the Fixture World (`./world.ts`); the docs
   * screenshot set (`../docs/`) seeds its own through the same writer.
   */
  world?: FixtureWorld
  /**
   * Renders the Frame Captures behind each Thumbnail Manifest. Defaults to the
   * synthetic wireframes (`./frame-captures.ts`); the docs set photographs its
   * real previews instead.
   */
  renderCaptures?: typeof renderFrameCaptures
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
  const filesDir = profile.env.LOCAL_FILES_DIR!

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
      rm(filesDir, { recursive: true, force: true }),
    ])
  }

  const world =
    options.world ?? buildFixtureWorld({ previewOrigin: profile.previewOrigin })

  // Encrypting the Project presets needs the profile's minted ENCRYPTION_KEY,
  // and `lib/crypto` reads it off `process.env` at first use — this process was
  // not necessarily launched with it, so apply the profile env here.
  Object.assign(process.env, profile.env)

  log(`• opening PGlite at ${pgliteDir}`)
  const handle = createPgliteDb(pgliteDir, {
    migrationsFolder: profile.env.PGLITE_MIGRATIONS_DIR,
  })
  try {
    await handle.ready
    await seedDatabase(handle.db, world)
    if (profile.hosted) {
      await seedHostedDatabase(handle.db, world)
      log(`• seeded ${world.hosted.threads.length} comment threads (hosted)`)
    }
    log(
      `• seeded ${world.rooms.length} canvases, ${world.folders.length} folders`
    )

    const captures = await seedRoomDocs(world, {
      yjsDir,
      filesDir,
      blobDir,
      blobBaseUrl,
      db: handle.db,
      renderCaptures: options.renderCaptures ?? renderFrameCaptures,
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
 * The hosted build's rows (#789): the fixture user's name and signed-in
 * session, everyone's membership of every Canvas, and the comment threads.
 * Upserts, like the rest. Runs after {@link seedDatabase}, whose user and
 * rooms these reference.
 */
async function seedHostedDatabase(db: DB, world: FixtureWorld): Promise<void> {
  const { hosted } = world
  await db
    .update(schema.user)
    .set({ name: hosted.userName })
    .where(eq(schema.user.id, world.userId))
  for (const person of hosted.collaborators) {
    await db.insert(schema.user).values(person).onConflictDoNothing()
  }

  await db
    .insert(schema.session)
    .values({
      id: "session-screenshot-fixture",
      userId: world.userId,
      token: FIXTURE_SESSION_TOKEN,
      expiresAt: new Date(world.now + 365 * 24 * 60 * 60 * 1000),
    })
    .onConflictDoUpdate({
      target: schema.session.id,
      set: { expiresAt: new Date(world.now + 365 * 24 * 60 * 60 * 1000) },
    })

  const members = [
    { userId: world.userId, role: "owner" as const },
    ...hosted.collaborators.map((p) => ({
      userId: p.id,
      role: "editor" as const,
    })),
  ]
  for (const room of world.rooms) {
    for (const member of members) {
      await db
        .insert(schema.roomMember)
        .values({ roomId: room.id, ...member })
        .onConflictDoNothing()
    }
  }

  for (const t of hosted.threads) {
    const createdAt = new Date(t.comments[0]!.createdAt)
    await db
      .insert(schema.thread)
      .values({
        id: t.id,
        roomId: t.roomId,
        x: null,
        y: null,
        iframeLayerId: t.iframeLayerId ?? null,
        selector: t.anchor?.path ?? null,
        offsetX: t.offsetX ?? null,
        offsetY: t.offsetY ?? null,
        workspaceId: t.workspaceId ?? null,
        route: t.route ?? null,
        anchor: t.anchor ?? null,
        viewportWidth: t.viewportWidth ?? null,
        viewportHeight: t.viewportHeight ?? null,
        snapshot: t.anchor ? snapshotLabel(t.anchor) : null,
        branch: t.branch ?? null,
        createdBy: t.comments[0]!.authorId,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing()
    for (const c of t.comments) {
      await db
        .insert(schema.comment)
        .values({
          id: c.id,
          threadId: t.id,
          authorId: c.authorId,
          body: c.body,
          createdAt: new Date(c.createdAt),
        })
        .onConflictDoNothing()
    }
    // Everything is read but the newest thread, so its pin shows the dot.
    if (t !== newest(hosted.threads)) {
      await db
        .insert(schema.threadRead)
        .values({
          threadId: t.id,
          userId: world.userId,
          lastReadAt: new Date(world.now),
        })
        .onConflictDoNothing()
    }
  }
}

function newest<T extends { comments: { createdAt: number }[] }>(
  threads: readonly T[]
): T | undefined {
  const last = (t: T) => t.comments.at(-1)?.createdAt ?? 0
  return [...threads].sort((a, b) => last(b) - last(a))[0]
}

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
      const planStatus = plan.status ?? "pending"
      // A resolved plan belongs to a run that went on to finish; only a
      // pending one leaves its run paused.
      const runStatus =
        planStatus === "pending" ? "paused_for_plan" : "completed"
      await db
        .insert(schema.agentRun)
        .values({
          id: plan.runId,
          chatId: chat.id,
          status: runStatus,
          startedAt: new Date(plan.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.agentRun.id,
          set: { status: runStatus },
        })
      await db
        .insert(schema.agentPendingToolCall)
        .values({
          id: plan.toolCallId,
          runId: plan.runId,
          chatId: chat.id,
          toolName: "submit_plan",
          input: { plan: plan.plan },
          status: planStatus,
          createdAt: new Date(plan.createdAt),
        })
        .onConflictDoUpdate({
          target: schema.agentPendingToolCall.id,
          set: { input: { plan: plan.plan }, status: planStatus },
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
  // `lib/repository-library/store.ts` reads (`user-workspace-configs:<userId>`, kept
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
  // Account memory (#1513), under the key `lib/memory/account-store.ts` reads.
  if (world.accountMemory) {
    const value = encrypt(JSON.stringify(world.accountMemory))
    await db
      .insert(schema.kvStore)
      .values({ key: `account-memory:${world.userId}`, value, expiresAt: null })
      .onConflictDoUpdate({ target: schema.kvStore.key, set: { value } })
  }
  // Account Files' entries (#1521), under the key `lib/files/account-store.ts`
  // reads; their bytes go with the rooms' (`seedRoomDocs`).
  if (world.accountFiles) {
    const value = encrypt(JSON.stringify(world.accountFiles.files))
    await db
      .insert(schema.kvStore)
      .values({ key: `account-files:${world.userId}`, value, expiresAt: null })
      .onConflictDoUpdate({ target: schema.kvStore.key, set: { value } })
  }
  // Canvas Repos' env var values (#1416), under the key `lib/repo-env` reads.
  for (const room of world.rooms) {
    for (const [repoId, text] of Object.entries(room.doc?.repoEnv ?? {})) {
      const value = encrypt(text)
      await db
        .insert(schema.kvStore)
        .values({
          key: canvasRepoEnvKey(room.id, repoId),
          value,
          expiresAt: null,
        })
        .onConflictDoUpdate({ target: schema.kvStore.key, set: { value } })
    }
  }
  // A fixture world is shown as authored: mark the repository library's
  // one-time Canvas migration done (the store's `repository-library-migrated:`
  // key) so a first load never links or adds Repositories behind its back.
  await db
    .insert(schema.kvStore)
    .values({
      key: `repository-library-migrated:${world.userId}`,
      value: "1",
      expiresAt: null,
    })
    .onConflictDoNothing()
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
  ctx: {
    yjsDir: string
    filesDir: string
    blobDir: string
    blobBaseUrl: string
    db: DB
    renderCaptures: typeof renderFrameCaptures
  }
): Promise<number> {
  await mkdir(ctx.yjsDir, { recursive: true })
  let captureCount = 0

  for (const room of world.rooms) {
    const doc = new Y.Doc()
    applyRoomDoc(doc, room)
    await seedRoomSkills(doc, room, ctx.filesDir)

    // Match `FileYjsPersistence.fileFor`: one file per room holding the full
    // encoded state, keyed by the url-encoded room id.
    await writeFile(
      join(ctx.yjsDir, `${encodeURIComponent(room.id)}.ydoc`),
      Y.encodeStateAsUpdate(doc)
    )

    // Canvas Files' bytes, where the local file store looks for them.
    for (const entry of room.doc?.files ?? []) {
      const body = room.doc?.fileBodies?.[entry.path]
      if (entry.kind !== "file" || body === undefined) continue
      const path = join(ctx.filesDir, entry.blobKey)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, await fileFixtureBytes(body))
    }

    // Mockup pages, each its folder's `index.html` (`lib/mockup-folder`).
    for (const [layerId, html] of Object.entries(room.doc?.mockupHtml ?? {})) {
      const path = join(
        ctx.filesDir,
        mockupFolderPrefix(room.id, layerId),
        MOCKUP_INDEX
      )
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, html)
    }

    captureCount += await seedRoomThumbnail(room, ctx)
    doc.destroy()
  }

  // Account Files' bytes, beside Canvas Files'.
  for (const entry of world.accountFiles?.files ?? []) {
    const body = world.accountFiles?.fileBodies[entry.path]
    if (entry.kind !== "file" || body === undefined) continue
    const path = join(ctx.filesDir, entry.blobKey)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await fileFixtureBytes(body))
  }

  await seedAccountSkills(world, ctx.filesDir, ctx.db)

  return captureCount
}

/** Populate one Room's Y.Doc from its fixture entry. */
function applyRoomDoc(doc: Y.Doc, room: FixtureRoom): void {
  const fixture = room.doc
  if (!fixture) return
  const c = getRoomCollections(doc)

  c.transact(() => {
    for (const repo of fixture.repos ?? []) {
      // Names and digest only, as the app writes them (#1416); the values
      // are in the KV store (`seedDatabase`).
      const env = fixture.repoEnv?.[repo.id]
      c.repos.set(
        repo.id,
        env
          ? {
              ...repo,
              envVarNames: envVarNames(env),
              envVarsDigest: envVarsDigest(env),
            }
          : repo
      )
    }
    for (const branch of fixture.branches ?? [])
      c.branches.set(branch.id, branch)
    for (const layer of fixture.iframeLayers ?? [])
      c.iframeLayers.set(layer.id, layer)
    for (const layer of fixture.markdownLayers ?? [])
      c.markdownLayers.set(layer.id, layer)
    for (const layer of fixture.mockupLayers ?? [])
      c.mockupLayers.set(layer.id, layer)
    // Groups last: the legacy-group migration in `getRoomCollections` wraps any
    // layer no group references, and writing the groups after the layers means
    // there is nothing left for it to wrap.
    for (const group of fixture.iframeLayerGroups ?? [])
      c.iframeLayerGroups.set(group.id, group)
    for (const page of fixture.pages ?? []) c.pages.set(page.id, page)
    for (const chat of fixture.chatSessions ?? [])
      c.chatSessions.set(chat.id, chat)
    for (const plan of fixture.plans ?? []) c.plans.set(plan.id, plan)
    for (const memory of fixture.memories ?? [])
      c.memories.set(memory.id, memory)
    for (const file of fixture.files ?? []) c.files.set(file.id, file)
    if (fixture.savedViewport) c.savedViewport.set(fixture.savedViewport)
  })

  // Document bodies go through the same TipTap-backed writer the agent's
  // document tools use, so the seeded XmlFragment is one the editor can mount
  // (a hand-built fragment that fails the `heading block*` schema renders blank).
  for (const [layerId, markdown] of Object.entries(
    fixture.markdownBodies ?? {}
  )) {
    writeDocumentMarkdown(documentFragment(doc, layerId), markdown, {
      keepTitle: false,
    })
  }
  // Mockup pages are folders in the file store (#1886, `seedRoomDocs`
  // writes them); the record carries the folder's revision.
  for (const layerId of Object.keys(fixture.mockupHtml ?? {})) {
    c.mockupLayers.update(layerId, { revision: 1 })
  }
}

/**
 * Save a Room's fixture Skills through the skills module, into its doc's
 * `skills` collection and the local file store (`lib/files/local-fs.ts`'s
 * layout under `LOCAL_FILES_DIR`), as a chat's `save_skill` does.
 */
async function seedRoomSkills(
  doc: Y.Doc,
  room: FixtureRoom,
  filesDir: string
): Promise<void> {
  const skills = room.doc?.skills ?? []
  if (skills.length === 0) return
  const c = getRoomCollections(doc)
  const all = () =>
    Object.values(
      doc.getMap(COLLECTION_KEYS.skills).toJSON()
    ) as FileEntryData[]
  const saved = createSavedSkills({
    index: {
      entries: async () => all(),
      mutate: async (fn) => {
        let result!: ReturnType<typeof fn>
        c.transact(() => {
          result = fn({
            all,
            set: (entry) => c.skills.set(entry.id, entry),
            delete: (id) => c.skills.delete(id),
          })
        })
        return result
      },
    },
    store: localFileStore(filesDir),
    keyPrefix: `canvas/${room.id}/skills`,
  })
  await saveFixtureSkills(saved, skills)
}

/**
 * Save the fixture user's Account Skills (#1558) through the skills module:
 * bytes into the local file store, the list into `kv_store` under the key
 * `lib/files/account-store.ts` reads.
 */
async function seedAccountSkills(
  world: FixtureWorld,
  filesDir: string,
  db: DB
): Promise<void> {
  if (!world.accountSkills?.length) return
  const list = memoryFileListStore()
  await saveFixtureSkills(
    createSavedSkills({
      index: listFileIndex(list),
      store: localFileStore(filesDir),
      keyPrefix: `${accountFileKeyPrefix(world.userId)}/skills`,
    }),
    world.accountSkills
  )
  const value = encrypt(JSON.stringify(await list.load()))
  await db
    .insert(schema.kvStore)
    .values({ key: `account-skills:${world.userId}`, value, expiresAt: null })
    .onConflictDoUpdate({ target: schema.kvStore.key, set: { value } })
}

async function saveFixtureSkills(
  saved: ReturnType<typeof createSavedSkills>,
  skills: readonly FixtureSkill[]
): Promise<void> {
  for (const skill of skills) {
    const result = await saved.save({
      name: skill.name,
      content: skill.content,
      files: skill.files,
      author: { addedBy: "agent", addedById: "fixture-chat" },
      now: skill.savedAt,
    })
    if (!result.ok)
      throw new Error(`Seeding skill ${skill.name}: ${result.error}`)
  }
}

/** The local file store's layout (`lib/files/local-fs.ts`) under `filesDir`. */
function localFileStore(filesDir: string): FileStore {
  return {
    async put(key, body) {
      const path = join(filesDir, key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    },
    async get(key) {
      return new Uint8Array(await readFile(join(filesDir, key)))
    },
    async delete(keys) {
      await Promise.all(keys.map((key) => rm(join(filesDir, key))))
    },
    async size(key) {
      return (await stat(join(filesDir, key)).catch(() => null))?.size ?? null
    },
    async list() {
      throw new Error("Seeding never lists the file store.")
    },
  }
}

/** Render a Room's Frame Captures and persist the manifest they belong to. */
async function seedRoomThumbnail(
  room: FixtureRoom,
  ctx: {
    blobDir: string
    blobBaseUrl: string
    db: DB
    renderCaptures: typeof renderFrameCaptures
  }
): Promise<number> {
  const frameIds = room.thumbnailFrames ?? []
  if (frameIds.length === 0 || !room.doc) return 0

  // The cover is the first page, as `readRoomCaptureLayout` derives it.
  const pages = orderedPages(room.doc.pages ?? [])
  const groups = groupsOnPage(
    room.doc.iframeLayerGroups ?? [],
    pages,
    pages[0]!.id
  )
  const iframeLayers = room.doc.iframeLayers ?? []
  const layouts = computeIframeLayerLayouts(groups, iframeLayers, [
    ...(room.doc.markdownLayers ?? []),
    ...(room.doc.mockupLayers ?? []),
  ])
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
      accentIndex: branch?.colorIndex ?? null,
    })
    manifestLayers.push({ id: frameId, label: layer.label })
  }
  if (requests.length === 0) return 0

  const rendered = await ctx.renderCaptures(
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

/** A fixture file's bytes: its text, or the committed file it names. */
async function fileFixtureBytes(
  body: FileFixtureBody
): Promise<string | Buffer> {
  if (typeof body === "string") return body
  const here = dirname(fileURLToPath(import.meta.url))
  return readFile(join(here, "files", body.file))
}
