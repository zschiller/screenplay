import { documentFragment } from "@/lib/yjs/fragment-text"
import { mockupHtml } from "@/lib/yjs/mockup-html"
import { readDocumentBody, roomMentionLabels } from "@/lib/document-markdown"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"
import type { LayerFileData } from "@/lib/types"
import { readCanvasFiles } from "./canvas-files"
import { layerFilePaths } from "./layer-files"
import type { MirrorExtra } from "./mirror"

/**
 * A canvas's Documents and Mockups as the Mac's Files mirror writes them
 * (#1884): a Document as markdown under its title, a Mockup as its page, at
 * the paths the Files tree lists them by.
 */
export function layerFileExports(c: RoomCollections): MirrorExtra[] {
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
  return files.map((file) => {
    const path = paths.get(file.id)!
    if (file.kind === "mockup") {
      return { path, text: mockupHtml(c.doc, file.id).toString() }
    }
    const body = readDocumentBody(documentFragment(c.doc, file.id), labelOf)
    const title = file.title ? `# ${file.title}\n\n` : ""
    return { path, text: `${title}${body}\n` }
  })
}
