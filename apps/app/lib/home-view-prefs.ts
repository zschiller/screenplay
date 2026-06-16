/**
 * Home view preferences — the grid/table layout plus the per-surface sort key +
 * direction the home surfaces (Recents, All files, each folder) remember.
 *
 * The grid/table `view` is *global*: one layout shared by every surface, so
 * flipping to the table anywhere flips it everywhere. The sort key + direction
 * stay *per-surface*, keyed by scope, so each home surface keeps its own order.
 *
 * Persisted in one cookie so the right layout paints on first load, server-seeded
 * the same way the panel layout is (see `lib/panel-layout`).
 *
 * Pure and dependency-free apart from the shared sort types, so the parse and
 * scope-key rules stay testable in isolation and the cookie can be read in the
 * server layout without dragging the client provider in.
 */
import type { SortKey, SortOrder } from "./room-sort"

export type View = "grid" | "table"

/** One surface's remembered ordering: how it sorts and in which direction. */
export type HomeScopeSort = {
  sort: SortKey
  order: SortOrder
}

/**
 * The persisted home view prefs: a single global grid/table `view` plus the
 * per-scope sort, keyed by `homeScopeKey`.
 */
export type HomeViewPrefs = {
  view: View
  scopes: { [scopeKey: string]: HomeScopeSort }
}

const COOKIE_NAME = "home_view_prefs"
const MAX_AGE = 60 * 60 * 24 * 365

const VIEWS: readonly View[] = ["grid", "table"]
const SORT_KEYS: readonly SortKey[] = ["updated", "created", "name"]
const ORDERS: readonly SortOrder[] = ["asc", "desc"]

/** The starting grid/table layout before the user picks one: the grid. */
export const DEFAULT_VIEW: View = "grid"

/** A scope's starting order before the user sorts it: last-edited, newest first
 * — the same defaults the home store shipped with. */
export const DEFAULT_SCOPE_SORT: HomeScopeSort = {
  sort: "updated",
  order: "desc",
}

/** The provider's starting point before any cookie: the grid, every scope unseen. */
export const DEFAULT_VIEW_PREFS: HomeViewPrefs = {
  view: DEFAULT_VIEW,
  scopes: {},
}

export function homeViewPrefsCookieName(): string {
  return COOKIE_NAME
}

/**
 * The key a home surface persists its sort under. Recents and the "All files"
 * root are distinct surfaces that both carry a null folder, so they key apart by
 * name; any other folder keys by its id. Mirrors the three cases
 * `deriveHomeScope` distinguishes.
 */
export function homeScopeKey(
  folderView: boolean,
  currentFolderId: string | null
): string {
  if (!folderView) return "recent"
  return currentFolderId ?? "all"
}

function isView(v: unknown): v is View {
  return typeof v === "string" && VIEWS.includes(v as View)
}

function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && SORT_KEYS.includes(v as SortKey)
}

function isOrder(v: unknown): v is SortOrder {
  return typeof v === "string" && ORDERS.includes(v as SortOrder)
}

/**
 * Parse the cookie into prefs, falling back to the default grid view when the
 * stored `view` is missing/invalid and dropping any scope whose stored sort
 * doesn't fully validate (a hand-edited cookie, or one written by an older
 * build) rather than trusting partial data. Returns the defaults for a missing
 * or unreadable cookie.
 */
export function parseHomeViewPrefs(rawValue: string | undefined): HomeViewPrefs {
  if (!rawValue) return { view: DEFAULT_VIEW, scopes: {} }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(rawValue))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { view: DEFAULT_VIEW, scopes: {} }
    const { view, scopes } = parsed as Record<string, unknown>
    const out: HomeViewPrefs = {
      view: isView(view) ? view : DEFAULT_VIEW,
      scopes: {},
    }
    if (scopes && typeof scopes === "object" && !Array.isArray(scopes)) {
      for (const [key, value] of Object.entries(scopes)) {
        if (!value || typeof value !== "object") continue
        const { sort, order } = value as Record<string, unknown>
        if (isSortKey(sort) && isOrder(order)) {
          out.scopes[key] = { sort, order }
        }
      }
    }
    return out
  } catch {}
  return { view: DEFAULT_VIEW, scopes: {} }
}

/** A new prefs object with the global grid/table `view` set to `view`. */
export function withView(prefs: HomeViewPrefs, view: View): HomeViewPrefs {
  return { ...prefs, view }
}

/** A new prefs object with `patch` merged into `key`'s sort (defaults fill any gap). */
export function withScopeSort(
  prefs: HomeViewPrefs,
  key: string,
  patch: Partial<HomeScopeSort>
): HomeViewPrefs {
  const base = prefs.scopes[key] ?? DEFAULT_SCOPE_SORT
  return {
    ...prefs,
    scopes: { ...prefs.scopes, [key]: { ...base, ...patch } },
  }
}

export function writeHomeViewPrefs(prefs: HomeViewPrefs): void {
  if (typeof document === "undefined") return
  const value = encodeURIComponent(JSON.stringify(prefs))
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${MAX_AGE}; samesite=lax`
}
