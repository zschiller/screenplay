import { canvasFileKeyPrefix } from "@/lib/files/paths"
import type { MockupLayerData } from "@/lib/types"

/**
 * **Mockup Folders** (#1886, spec #1882): a Mockup's page is a folder in the
 * canvas's private file store, beside its Canvas Files: an `index.html` and
 * whatever it loads by relative path (a data script, captures, a stylesheet).
 * The room doc keeps the Mockup's file record and a `revision` that every
 * write to the folder bumps, so every view reloads.
 *
 * A view renders the page as it always has, as an `<iframe srcdoc>` in an
 * opaque origin (`mockupSrcDoc`), with `index.html` fetched through the
 * members-only folder route and a `<base>` pointing at the **pages route**
 * (`/api/mockup-pages/<token>/r<revision>/`), so its relative paths load from
 * the folder. A sandboxed page sends no cookies, so the pages route takes a
 * signed token in its path instead: one Mockup's folder in one canvas, for a
 * day, minted only for a member (`mockup-folder-server.ts`).
 *
 * This module is the part both sides share: names, limits and URL shapes.
 */

/**
 * Where one Mockup's folder keeps its files in the file store. A file id is
 * a nanoid; anything else could name a key outside the folder, so it throws.
 */
export function mockupFolderPrefix(roomId: string, fileId: string): string {
  if (!isMockupFileId(fileId)) throw new Error(`Bad Mockup id: ${fileId}`)
  return `${canvasFileKeyPrefix(roomId)}/mockups/${fileId}/`
}

/** Whether `id` can be a Mockup's file id, and so name its folder. */
export function isMockupFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/** The page a Mockup's folder opens at. */
export const MOCKUP_INDEX = "index.html"

/**
 * The most a Mockup's folder holds, every file together, in bytes: the most
 * one Canvas File can be. It replaces the cap on how many references a page
 * may name (#1643) for files in the folder.
 */
export const MOCKUP_FOLDER_MAX_BYTES = 25 * 1024 * 1024

/** How long a pages-route token lasts; a view fetches a fresh one before. */
export const MOCKUP_PAGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** Where the pages route serves a Mockup's folder at one revision. */
export function mockupPagesPath(token: string, revision: number): string {
  return `/api/mockup-pages/${token}/r${revision}/`
}

/**
 * The part of a pages-route URL every revision of one Mockup shares: what
 * the page's Content Security Policy lets it load from.
 */
export function mockupPagesScope(base: string): string {
  return base.replace(/r\d+\/$/, "")
}

/**
 * Whether a Mockup has a page to show: a folder someone wrote, a copy still
 * to make, or a page from before folders still in the room doc (`legacyHtml`,
 * its `mockup-layer-{fileId}` text). An empty Mockup is one someone drew and
 * sent to a chat that hasn't filled it yet.
 */
export function mockupHasPage(
  layer: Pick<MockupLayerData, "revision" | "copyOf">,
  legacyHtml: string
): boolean {
  return (layer.revision ?? 0) > 0 || !!layer.copyOf || !!legacyHtml.trim()
}

/** What the folder route answers: the page and where its folder loads from. */
export type MockupPageResponse = {
  /** `index.html`, or "" when the Mockup has no page yet. */
  html: string
  revision: number
  /** The pages-route path (base path included) the page's `<base>` names. */
  base: string
  /** When `base` stops working, in ms since the epoch. */
  expiresAt: number
}
