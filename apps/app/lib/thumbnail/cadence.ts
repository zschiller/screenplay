import { isLocalBuild } from "@/lib/local-mode"

/**
 * The cadence bounds for the per-frame thumbnail system, split into two
 * independent lanes (#474) so the cheap work isn't stuck behind the expensive
 * work:
 *
 * - **Layout lane.** A moved/resized/renamed/recolored frame only changes the
 *   manifest's *rects* — no screenshot. The client coalesces a burst of Y.Doc
 *   updates with a short trailing debounce ({@link THUMBNAIL_LAYOUT_DEBOUNCE_MS})
 *   and POSTs a layout-only rebuild (`frameIds: []`) that opens no browser and
 *   doesn't touch the capture clock. So the home grid's skeleton tracks edits
 *   almost live.
 * - **Capture lane.** A frame's *pixels* only change when its content settles —
 *   first paint, a route/branch reload, or an HMR reconnect. The client waits
 *   for that "good rendered state" signal (the {@link DirtyFrameTracker}) and
 *   screenshots after it goes quiet for {@link THUMBNAIL_CAPTURE_SETTLE_MS}, so
 *   we snapshot a settled page, not a mid-reload flash. The server route then
 *   drops any capture landing within {@link THUMBNAIL_CAPTURE_COOLDOWN_MS} of the
 *   last one — the floor on capture frequency during sustained churn (each
 *   hosted round is a paid headless-Chromium shot; the desktop build runs local
 *   Tauri-webview screenshots and refreshes far hotter).
 *
 * React-free and server-free so both the client hook and the server route share
 * one source of truth, guarded by `cadence.test.ts`.
 */

/**
 * Trailing debounce for the layout lane: a burst of Y.Doc updates (a drag)
 * coalesces into one layout-only manifest write this long after the last change.
 * Short in both builds — the write is cheap (no browser) — so the home grid's
 * rects feel live.
 */
export const THUMBNAIL_LAYOUT_DEBOUNCE_MS = 500

/**
 * Trailing settle for the capture lane: once a frame reports ready+dirty, wait
 * this long with no further ready/dirty signal before screenshotting, so an HMR
 * storm or a multi-step reload collapses into one shot of the settled page.
 * Hotter on desktop, where a round is cheap.
 */
export const THUMBNAIL_CAPTURE_SETTLE_MS = isLocalBuild ? 800 : 1_500

/** Short settle after mount before the backstop full capture (no thumbnail yet). */
export const THUMBNAIL_HEARTBEAT_INITIAL_DELAY_MS = 3_000

/**
 * Minimum gap since the last capture before the unmount catch-up round runs
 * ("edit then close tab"). Skipped when we just captured.
 */
export const THUMBNAIL_HEARTBEAT_MIN_REFRESH_GAP_MS = 3_000

/**
 * The server route's capture dedup window: a capture trigger within this of the
 * last actual capture is dropped. Reads `thumbnailUpdatedAt`, which layout-only
 * rebuilds deliberately leave untouched — so a stream of cheap layout writes
 * never starves the capture lane. Stays above {@link THUMBNAIL_CAPTURE_SETTLE_MS}
 * so a single post-settle capture is never swallowed by its own settle window.
 */
export const THUMBNAIL_CAPTURE_COOLDOWN_MS = isLocalBuild ? 3_000 : 12_000
