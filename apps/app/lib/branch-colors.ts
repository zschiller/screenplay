/**
 * Deterministic branch-name color assignment using Tailwind palette colors.
 *
 * Each color entry defines light-mode and dark-mode classes so the badge looks
 * good in both themes.  Colors are picked by hashing the branch string, which
 * is pure and SSR-safe (no Math.random, no useState).
 *
 * The palette is large enough (16 entries) that collisions are rare, and we
 * use a well-distributed hash (djb2) so neighboring branch names don't land
 * on the same color.
 *
 * Users can override the hashed assignment per Branch by storing a numeric
 * `colorIndex` on `BranchData` — pass that index to `getBranchColor` (or use
 * `getBranchColorByIndex`) and it bypasses the hash.
 */

export interface BranchColor {
  /** Badge background + text classes */
  badge: string
  /** Solid swatch (for the color picker UI) */
  swatch: string
  /** Human-readable name for tooltips/a11y */
  name: string
}

export const BRANCH_COLORS: BranchColor[] = [
  {
    name: "red",
    badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    swatch: "bg-red-500",
  },
  {
    name: "orange",
    badge:
      "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    swatch: "bg-orange-500",
  },
  {
    name: "amber",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    swatch: "bg-amber-500",
  },
  {
    name: "yellow",
    badge:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
    swatch: "bg-yellow-500",
  },
  {
    name: "lime",
    badge: "bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300",
    swatch: "bg-lime-500",
  },
  {
    name: "green",
    badge: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    swatch: "bg-green-500",
  },
  {
    name: "emerald",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    swatch: "bg-emerald-500",
  },
  {
    name: "teal",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
    swatch: "bg-teal-500",
  },
  {
    name: "cyan",
    badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
    swatch: "bg-cyan-500",
  },
  {
    name: "sky",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    swatch: "bg-sky-500",
  },
  {
    name: "blue",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    swatch: "bg-blue-500",
  },
  {
    name: "indigo",
    badge:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    swatch: "bg-indigo-500",
  },
  {
    name: "violet",
    badge:
      "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    swatch: "bg-violet-500",
  },
  {
    name: "purple",
    badge:
      "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
    swatch: "bg-purple-500",
  },
  {
    name: "fuchsia",
    badge:
      "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300",
    swatch: "bg-fuchsia-500",
  },
  {
    name: "rose",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    swatch: "bg-rose-500",
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
