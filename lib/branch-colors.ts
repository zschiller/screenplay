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
 */

export interface BranchColor {
  /** Badge background + text classes */
  badge: string
}

const BRANCH_COLORS: BranchColor[] = [
  // red
  { badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  // orange
  { badge: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  // amber
  { badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  // yellow
  { badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
  // lime
  { badge: "bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-300" },
  // green
  { badge: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  // emerald
  { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  // teal
  { badge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" },
  // cyan
  { badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300" },
  // sky
  { badge: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  // blue
  { badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  // indigo
  { badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  // violet
  { badge: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  // purple
  { badge: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
  // fuchsia
  { badge: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300" },
  // rose
  { badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
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
 * Return the color entry for a branch name.
 * Pure function – same input always yields the same output (SSR-safe).
 */
export function getBranchColor(branch: string): BranchColor {
  return BRANCH_COLORS[djb2(branch) % BRANCH_COLORS.length]
}
