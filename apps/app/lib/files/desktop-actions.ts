"use server"

import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import { canvasFiles } from "@/lib/files"
import { isLocalBuild } from "@/lib/local-mode"
import { openRoom } from "@/lib/room-access"
import { getRoom } from "@/lib/rooms"
import { mirrorFolderName, syncFileMirror } from "./mirror"
import { normalizeFilePath } from "./paths"

const run = promisify(execFile)

/** Where the desktop keeps readable copies of canvas files: beside the store. */
function mirrorRoot(): string {
  const store = process.env.LOCAL_FILES_DIR ?? ".screenplay/files"
  return join(dirname(store), "Canvas files")
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
  const p = normalizeFilePath(path)
  if ("error" in p) throw new Error(p.error)

  const record = await getRoom(roomId)
  const dir = join(mirrorRoot(), mirrorFolderName(record?.name ?? "", roomId))
  await syncFileMirror(canvasFiles(room), dir)
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
