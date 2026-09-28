import type { FolderContents } from "./home-provider"

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * A folder's contents as its row and tile print them: "3 canvases",
 * "1 folder, 2 canvases", or "Empty".
 */
export function formatFolderContents({
  folders,
  canvases,
}: FolderContents): string {
  const parts: string[] = []
  if (folders > 0) parts.push(plural(folders, "folder", "folders"))
  if (canvases > 0) parts.push(plural(canvases, "canvas", "canvases"))
  return parts.length > 0 ? parts.join(", ") : "Empty"
}
