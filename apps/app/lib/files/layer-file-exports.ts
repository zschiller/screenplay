import { documentFragment } from "@/lib/yjs/fragment-text"
import { readDocumentBody, roomMentionLabels } from "@/lib/document-markdown"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"
import type { LayerFileData } from "@/lib/types"
import { readCanvasFiles } from "./canvas-files"
import { layerFilePaths } from "./layer-files"
import type { MirrorExtra } from "./mirror"

/**
 * A canvas's Documents and Mockups as the Mac's Files mirror writes them
 * (#1884): a Document as markdown under its title, a Mockup as its page, at
 * the paths the Files tree lists them by. A Mockup's page lives in its
 * folder in the file store (#1886), so the caller reads it: `mockupPages`,
 * by file id; a Mockup missing from it is left out.
 */
export function layerFileExports(
  c: RoomCollections,
  mockupPages: ReadonlyMap<string, string>
): MirrorExtra[] {
  // The raw Y.Map: a collection's array is only fresh while observed, and
  // nothing observes it on the server.
  const files = Object.values(
    c.doc.getMap(COLLECTION_KEYS.layerFiles).toJSON()
  ) as LayerFileData[]
  const paths = layerFilePaths(
    files,
    readCanvasFiles(c).map((f) => f.path)
  )
  const labelOf = roomMentionLabels(c)
  return files.flatMap((file) => {
    const path = paths.get(file.id)!
    if (file.kind === "mockup") {
      const html = mockupPages.get(file.id)
      return html === undefined ? [] : [{ path, text: html }]
    }
    const body = readDocumentBody(documentFragment(c.doc, file.id), labelOf)
    const title = file.title ? `# ${file.title}\n\n` : ""
    return [{ path, text: `${title}${body}\n` }]
  })
}

/** The ids of a canvas's Mockup files, for reading their pages first. */
export function mockupFileIds(c: RoomCollections): string[] {
  const files = Object.values(
    c.doc.getMap(COLLECTION_KEYS.layerFiles).toJSON()
  ) as LayerFileData[]
  return files.filter((f) => f.kind === "mockup").map((f) => f.id)
}
