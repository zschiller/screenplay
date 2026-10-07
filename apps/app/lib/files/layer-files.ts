import type { LayerFileData, LayerFileKind } from "@/lib/types"

/**
 * Documents and Mockups in Files (#1884, spec #1882): Canvas settings › Files
 * lists every Document and Mockup file beside the canvas's saved files, and
 * the Mac's mirror writes them out by the same paths, a Document as markdown
 * and a Mockup as its page, so Finder and other apps can open them.
 */

/** The folder each kind sits in, in the Files tree and the mirror. */
export const LAYER_FILE_FOLDERS: Record<LayerFileKind, string> = {
  document: "Documents",
  mockup: "Mockups",
}

const EXTENSIONS: Record<LayerFileKind, string> = {
  document: ".md",
  mockup: ".html",
}

/** The media type each kind is written as. */
export const LAYER_FILE_MEDIA_TYPES: Record<LayerFileKind, string> = {
  document: "text/markdown",
  mockup: "text/html",
}

/** A file's name from its title: one path segment, never empty. */
function safeName(title: string): string {
  const safe = title
    .replace(/[/\\:]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120)
  return safe || "Untitled"
}

/**
 * Each file's path, by file id: `Documents/<title>.md` or
 * `Mockups/<title>.html`. Two files with one title (or a title a saved file
 * already uses, in `taken`) get “ 2”, “ 3” after the name, matched without
 * case as the Mac's disk does. The same files always get the same paths.
 */
export function layerFilePaths(
  files: readonly Pick<LayerFileData, "id" | "kind" | "title">[],
  taken: Iterable<string> = []
): Map<string, string> {
  const used = new Set([...taken].map((p) => p.toLowerCase()))
  const ordered = [...files].sort(
    (a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
  const paths = new Map<string, string>()
  for (const file of ordered) {
    const folder = LAYER_FILE_FOLDERS[file.kind]
    const name = safeName(file.title)
    const ext = EXTENSIONS[file.kind]
    let path = `${folder}/${name}${ext}`
    for (let n = 2; used.has(path.toLowerCase()); n++) {
      path = `${folder}/${name} ${n}${ext}`
    }
    used.add(path.toLowerCase())
    paths.set(file.id, path)
  }
  return paths
}

/** Where a Document or Mockup is, for the Files row's muted meta. */
export function layerFileDetail(views: number): string {
  if (views === 0) return "Not on canvas"
  return views === 1 ? "1 view" : `${views} views`
}
