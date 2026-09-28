/**
 * Deterministic Workspace identity color assignment.
 *
 * A Branch's color is identity, not state: it tells two Workspaces apart in
 * the sidebar, frame rows, pickers and chat header, drawn as a small square
 * swatch beside the title. The palette deliberately has **no red, amber or
 * green** — those hues belong to status (failed, working, passing), and a
 * healthy Workspace must never read as an error.
 *
 * Colors are picked by hashing a key (the Branch id) with djb2, which is pure
 * and SSR-safe (no Math.random, no useState). Users can override the hashed
 * assignment per Branch by storing a numeric `colorIndex` on `BranchData` —
 * pass that index to `getBranchColor` (or use `getBranchColorByIndex`) and it
 * bypasses the hash. A stored index from an older, larger palette falls back
 * to the hash.
 */

export interface BranchColor {
  /** Solid 8px identity swatch */
  swatch: string
  /** Soft background tint (thumbnail placeholders), theme-aware */
  tint: string
  /** Human-readable name for tooltips/a11y */
  name: string
}

export const BRANCH_COLORS: BranchColor[] = [
  {
    name: "indigo",
    swatch: "bg-indigo-500 dark:bg-indigo-400",
    tint: "bg-indigo-100 dark:bg-indigo-950",
  },
  {
    name: "cyan",
    swatch: "bg-cyan-600 dark:bg-cyan-400",
    tint: "bg-cyan-100 dark:bg-cyan-950",
  },
  {
    name: "violet",
    swatch: "bg-violet-600 dark:bg-violet-400",
    tint: "bg-violet-100 dark:bg-violet-950",
  },
  {
    name: "slate",
    swatch: "bg-slate-500 dark:bg-slate-400",
    tint: "bg-slate-200 dark:bg-slate-800",
  },
  {
    name: "pink",
    swatch: "bg-pink-500 dark:bg-pink-400",
    tint: "bg-pink-100 dark:bg-pink-950",
  },
  {
    name: "teal",
    swatch: "bg-teal-600 dark:bg-teal-400",
    tint: "bg-teal-100 dark:bg-teal-950",
  },
]

/** djb2 string hash – fast, deterministic, good distribution */
function djb2(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * Resolve the palette *index* for a key — the manual `overrideIndex` when it's
 * a valid entry, otherwise the hashed index for `key`. Out-of-range overrides
 * fall back to the hash so a stale stored index can't blow up rendering.
 *
 * Pure and SSR-safe. Returning the index (rather than the entry) lets callers
 * snapshot it — e.g. into the Thumbnail Manifest — and re-resolve the
 * theme-aware classes later via {@link getBranchColorByIndex}.
 */
export function resolveBranchColorIndex(
  key: string,
  overrideIndex?: number
): number {
  if (
    typeof overrideIndex === "number" &&
    Number.isInteger(overrideIndex) &&
    overrideIndex >= 0 &&
    overrideIndex < BRANCH_COLORS.length
  ) {
    return overrideIndex
  }
  return djb2(key) % BRANCH_COLORS.length
}

/**
 * Return the color entry for a given key (e.g. sandbox ID or branch name).
 * Pure function – same input always yields the same output (SSR-safe).
 *
 * If `overrideIndex` is provided and refers to a valid palette entry, that
 * entry is returned instead of the hashed one. Out-of-range indices fall
 * back to the hash so a stale stored index can't blow up rendering.
 */
export function getBranchColor(
  key: string,
  overrideIndex?: number
): BranchColor {
  return BRANCH_COLORS[resolveBranchColorIndex(key, overrideIndex)]!
}

export function getBranchColorByIndex(index: number): BranchColor | undefined {
  return BRANCH_COLORS[index]
}
