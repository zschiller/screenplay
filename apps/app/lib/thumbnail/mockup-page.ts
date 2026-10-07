import "server-only"

import { withBasePath } from "@/lib/base-path"
import { getBaseURL } from "@/lib/base-url"
import { fileStore } from "@/lib/files"
import { mockupFolderOn, mockupPageBase } from "@/lib/mockup-folder-server"
import { mockupRefs } from "@/lib/mockup-refs"
import { mockupRefSources, resolveMockupRefs } from "@/lib/mockup-refs-server"
import type { RoomAccess, RoomReader } from "@/lib/room-access"
import { MOCKUP_RUNTIME_JS } from "@/lib/sandbox-bridge"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"

/** A page Chromium navigates to as a data URL stays under its 2MB cap. */
const MAX_PAGE_URL_BYTES = 1_900_000

/**
 * A Mockup's page as a URL the Thumbnail Capturer can load: the same document
 * its frame shows on the canvas (`mockupSrcDoc`, with the runtime, its
 * `skill:` and `files:` references, and its folder as its base, #1886), as a
 * data URL. The references resolve as
 * the viewer whose canvas asked for the capture sees them; a reader with no
 * viewer (a layout-only rebuild, which never captures) gets them empty.
 * Throws when the page is too large to load that way, so the capture keeps the
 * Mockup's last image.
 */
export async function mockupPageUrl(
  room: RoomReader | RoomAccess,
  mockupId: string,
  fileId: string
): Promise<string> {
  const page = await mockupFolderOn(room, fileStore).page(fileId)
  const html = page?.html ?? ""
  // The capturer loads the folder's files from this app, as a viewer does.
  const base = page?.revision
    ? new URL(
        withBasePath(mockupPageBase(room.roomId, fileId, page.revision).path),
        getBaseURL()
      ).href
    : undefined
  const refs = mockupRefs(html)
  const resources =
    refs.length > 0 && "mutateDoc" in room
      ? await resolveMockupRefs(
          refs,
          await mockupRefSources(room, { mockupId, userId: room.userId })
        )
      : {}
  const doc = mockupSrcDoc(html, MOCKUP_RUNTIME_JS, resources, base)
  const url = `data:text/html;base64,${Buffer.from(doc).toString("base64")}`
  if (url.length > MAX_PAGE_URL_BYTES) {
    throw new Error("the mockup’s page is too large to capture")
  }
  return url
}
