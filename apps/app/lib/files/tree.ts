import type { FileEntryData } from "@/lib/types"
import { baseName, parentPath } from "./paths"

/**
 * Canvas Files as the Files tree shows them (#1517): each folder holds its
 * contents, folders first, then files, each by name.
 */
export interface FileTreeNode {
  entry: FileEntryData
  name: string
  /** A folder's contents; empty for a file. */
  children: FileTreeNode[]
  /** Everything under a folder, at any depth; what deleting it deletes. */
  descendants: number
}

const byName = (a: FileTreeNode, b: FileTreeNode) =>
  a.entry.kind !== b.entry.kind
    ? a.entry.kind === "folder"
      ? -1
      : 1
    : a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * The tree over `entries`. A file whose folder has no entry of its own (the
 * files module always makes one, so only a stale doc could) sits under a
 * folder made up for it, so nothing is hidden.
 */
export function fileTree(entries: FileEntryData[]): FileTreeNode[] {
  const nodes = new Map<string, FileTreeNode>()
  const node = (entry: FileEntryData): FileTreeNode => {
    const existing = nodes.get(entry.path)
    if (existing) return existing
    const made = {
      entry,
      name: baseName(entry.path),
      children: [],
      descendants: 0,
    }
    nodes.set(entry.path, made)
    return made
  }
  // Folders first, so a real folder entry wins over a made-up one.
  const ordered = [...entries].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1
  )
  for (const entry of ordered) node(entry)

  const roots: FileTreeNode[] = []
  const attach = (child: FileTreeNode) => {
    const parent = parentPath(child.entry.path)
    if (!parent) {
      roots.push(child)
      return
    }
    let folder = nodes.get(parent)
    if (!folder) {
      folder = node(madeUpFolder(parent, child.entry))
      attach(folder)
    }
    folder.children.push(child)
  }
  for (const child of [...nodes.values()]) attach(child)

  const finish = (list: FileTreeNode[]): number => {
    list.sort(byName)
    return list.reduce((sum, n) => {
      n.descendants = finish(n.children)
      return sum + 1 + n.descendants
    }, 0)
  }
  finish(roots)
  return roots
}

function madeUpFolder(path: string, child: FileEntryData): FileEntryData {
  return {
    id: `folder:${path}`,
    path,
    kind: "folder",
    size: 0,
    mediaType: "",
    addedBy: child.addedBy,
    addedById: child.addedById,
    blobKey: "",
    createdAt: child.createdAt,
    updatedAt: child.updatedAt,
  }
}

/** "1 item", "3 items", "Empty". */
export function itemCount(n: number): string {
  return n === 0 ? "Empty" : n === 1 ? "1 item" : `${n} items`
}
