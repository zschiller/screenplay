"use server"

import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import { accountFiles, canvasFiles, fileStore } from "@/lib/files"
import { requireUserId } from "@/lib/auth-helpers"
import type { Files } from "./files"
import { macShell } from "@/lib/capabilities"
import { openRoom } from "@/lib/room-access"
import { getRoom } from "@/lib/rooms"
import { mockupFolderOn } from "@/lib/mockup-folder-server"
import { layerFileExports, mockupFileIds } from "./layer-file-exports"
import { mirrorFolderName, syncFileMirror, type MirrorExtra } from "./mirror"
import { normalizeFilePath } from "./paths"

const run = promisify(execFile)

/**
 * Where the desktop keeps readable copies of saved files, beside the store:
 * `Canvas files` (a folder per canvas) and `Account files`.
 */
function mirrorRoot(name: "Canvas files" | "Account files"): string {
  const store = process.env.LOCAL_FILES_DIR ?? ".screenplay/files"
  return join(dirname(store), name)
}

/**
 * The desktop's Open and Reveal in Finder for a canvas file or folder
 * (#1517): brings the canvas's readable copy up to date, then hands the item
 * to the Mac, which opens it in its default app or shows it in Finder. The
 * app runs on the person's own machine, so the server can. Hosted has no
 * such thing: there, Open shows the file in the app.
 */
export async function openCanvasFileOnDesktop(
  roomId: string,
  path: string,
  how: "open" | "reveal"
): Promise<void> {
  if (!macShell) throw new Error("Only the desktop app opens files.")
  const room = await openRoom(roomId)
  const record = await getRoom(roomId)
  // Its Documents and Mockups too (#1884), as .md and .html: a Mockup's
  // index.html from its folder (#1886).
  const folder = mockupFolderOn(room, fileStore)
  const pages = new Map<string, string>()
  for (const id of await room.readDoc(mockupFileIds)) {
    const page = await folder.page(id)
    if (page) pages.set(id, page.html)
  }
  const extra = await room.readDoc((c) => layerFileExports(c, pages))
  await openOnDesktop(
    canvasFiles(room),
    join(
      mirrorRoot("Canvas files"),
      mirrorFolderName(record?.name ?? "", roomId)
    ),
    path,
    how,
    extra
  )
}

/**
 * Settings › Files' Open and Reveal in Finder (#1521): the same as a canvas
 * file's, for one of your Account Files.
 */
export async function openAccountFileOnDesktop(
  path: string,
  how: "open" | "reveal"
): Promise<void> {
  if (!macShell) throw new Error("Only the desktop app opens files.")
  const userId = await requireUserId()
  await openOnDesktop(
    accountFiles(userId),
    mirrorRoot("Account files"),
    path,
    how
  )
}

/** Bring `dir`'s copy of `files` up to date, then open or reveal `path` in it. */
async function openOnDesktop(
  files: Files,
  dir: string,
  path: string,
  how: "open" | "reveal",
  extra: readonly MirrorExtra[] = []
): Promise<void> {
  const p = normalizeFilePath(path)
  if ("error" in p) throw new Error(p.error)
  await syncFileMirror(files, dir, extra)
  const target = join(dir, p.path)

  if (process.platform === "darwin") {
    await run("open", how === "reveal" ? ["-R", target] : [target])
  } else if (process.platform === "win32") {
    // Explorer exits 1 even when it opened the window.
    await run(
      "explorer",
      how === "reveal" ? [`/select,${target}`] : [target]
    ).catch(() => {})
  } else {
    await run("xdg-open", [how === "reveal" ? dirname(target) : target])
  }
}
