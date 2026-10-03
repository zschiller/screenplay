"use server"

import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import { accountFiles, canvasFiles } from "@/lib/files"
import { requireUserId } from "@/lib/auth-helpers"
import type { Files } from "./files"
import { isLocalBuild } from "@/lib/local-mode"
import { openRoom } from "@/lib/room-access"
import { getRoom } from "@/lib/rooms"
import { mirrorFolderName, syncFileMirror } from "./mirror"
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
  if (!isLocalBuild) throw new Error("Only the desktop app opens files.")
  const room = await openRoom(roomId)
  const record = await getRoom(roomId)
  await openOnDesktop(
    canvasFiles(room),
    join(
      mirrorRoot("Canvas files"),
      mirrorFolderName(record?.name ?? "", roomId)
    ),
    path,
    how
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
  if (!isLocalBuild) throw new Error("Only the desktop app opens files.")
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
  how: "open" | "reveal"
): Promise<void> {
  const p = normalizeFilePath(path)
  if ("error" in p) throw new Error(p.error)
  await syncFileMirror(files, dir)
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
