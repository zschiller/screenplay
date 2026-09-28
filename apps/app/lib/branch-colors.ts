/**
 * Deterministic branch-name color assignment using Tailwind palette colors.
 *
 * Each color entry defines light-mode and dark-mode classes so the badge looks
 * good in both themes.  Colors are picked by hashing the branch string, which
 * is pure and SSR-safe (no Math.random, no useState).
 *
 * A Workspace's color is identity, not state, so it never uses a hue that
 * reads as status: red, orange, amber, yellow, lime, green, emerald and rose
 * are marked `status` and are never picked, by the hash or in the color menu.
 * Otherwise a healthy Workspace could show up red and a failed one green.
 * They stay in the array only so stored indices (a Branch's `colorIndex`, a
 * Thumbnail Manifest's `paletteIndex`) keep pointing at the same entries.
 *
 * The hash (djb2) spreads keys over the remaining identity hues.
 *
 * Users can override the hashed assignment per Branch by storing a numeric
 * `colorIndex` on `BranchData` — pass that index to `getBranchColor` (or use
 * `getBranchColorByIndex`) and it bypasses the hash. A stored index that
 * names a status hue falls back to the hash.
 */

export interface BranchColor {
  /** Badge background + text classes */
  badge: string
  /** Solid swatch (for the color picker UI) */
  swatch: string
  /** Human-readable name for tooltips/a11y */
  name: string
  /** A hue that reads as status (error, warning, success). Never assigned. */
  status?: true
}

export const BRANCH_COLORS: BranchColor[] = [
  {
    name: "red",
    status: true,
    badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    swatch: "bg-red-500",
  },
  {
    name: "orange",
    status: true,
    badge:
      "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    swatch: "bg-orange-500",
  },
  {
    name: "amber",
    status: true,
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    swatch: "bg-amber-500",
  },
  {
    name: "yellow",
    status: true,
    badge:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
    swatch: "bg-yellow-500",
  },
  {
    name: "lime",
    status: true,
    badge: "bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300",
    swatch: "bg-lime-500",
  },
  {
    name: "green",
    status: true,
    badge: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    swatch: "bg-green-500",
  },
  {
    name: "emerald",
    status: true,
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
    status: true,
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

/** Indices into {@link BRANCH_COLORS} that may be assigned: every non-status hue. */
export const IDENTITY_COLOR_INDICES: readonly number[] = BRANCH_COLORS.flatMap(
  (c, i) => (c.status ? [] : [i])
)

/**
 * Resolve the palette *index* for a key — the manual `overrideIndex` when it's
 * a valid identity entry, otherwise the hashed index for `key`. Out-of-range
 * or status-hue overrides fall back to the hash, so a stale stored index can't
 * blow up rendering or paint a Workspace in a status color.
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
    overrideIndex < BRANCH_COLORS.length &&
    !BRANCH_COLORS[overrideIndex]!.status
  ) {
    return overrideIndex
  }
  return IDENTITY_COLOR_INDICES[djb2(key) % IDENTITY_COLOR_INDICES.length]!
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
