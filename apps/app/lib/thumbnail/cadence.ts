import { isLocalBuild } from "@/lib/local-mode"

/**
 * The cadence bounds for the per-frame thumbnail capture round, split by build.
 *
 * A "round" is one `captureRoomThumbnail` run — it reads the room's layout and
 * screenshots every ready Iframe Layer's preview URL in a loop. Two seams bound
 * how often a round happens: the client heartbeat (`use-thumbnail-heartbeat.ts`)
 * triggers a round at most once per {@link THUMBNAIL_HEARTBEAT_PERIOD_MS}, and
 * the server route (`api/thumbnail/[roomId]`) drops any trigger that lands
 * within {@link THUMBNAIL_CAPTURE_COOLDOWN_MS} of the last one.
 *
 * They live here, in one React-free, server-free module, because the load-
 * bearing relationship between them is a single contract — `PERIOD_MS` must stay
 * above `COOLDOWN_MS` so a throttled heartbeat fire never lands inside the
 * cooldown and gets silently skipped — and it's now guarded by `cadence.test.ts`
 * rather than only the comments at each call site.
 *
 * The desktop (local) build runs both bounds much hotter than the hosted build:
 * a hosted round is a headless-Chromium capture on a paid function, while a
 * desktop round is N local Tauri-webview screenshots plus local-fs writes, cheap
 * enough to refresh the per-frame composite far more often.
 */
export const THUMBNAIL_HEARTBEAT_PERIOD_MS = isLocalBuild ? 8_000 : 30_000

/** Short settle after mount before the first round, so iframes can load. */
export const THUMBNAIL_HEARTBEAT_INITIAL_DELAY_MS = 3_000

/**
 * Minimum gap since the last fire before the unmount catch-up round runs
 * ("edit then close tab"). Skipped when we just fired.
 */
export const THUMBNAIL_HEARTBEAT_MIN_REFRESH_GAP_MS = 5_000

/**
 * The server route's dedup window: a trigger within this of the last round is
 * dropped. Must stay below {@link THUMBNAIL_HEARTBEAT_PERIOD_MS} so throttled
 * heartbeat fires aren't skipped.
 */
export const THUMBNAIL_CAPTURE_COOLDOWN_MS = isLocalBuild ? 6_000 : 25_000
