import type { UnsavedWork } from "@/lib/branch/unsaved-work"

/**
 * The **git state of each Fixture World checkout** (issue #776). A capture has
 * no real Sandboxes, so `getUnsavedWork` answers from this table instead of
 * running git, and the delete confirms can be photographed with the states
 * worth reviewing: an open PR with unpushed commits and uncommitted files, a
 * Workspace with only uncommitted changes, and clean ones.
 *
 * Keyed by Sandbox name (the seeded Workspaces in
 * `screenshots/fixtures/world.ts`). Only read under `isFixtureWorld`.
 */
const FIXTURE_UNSAVED_WORK: Record<string, UnsavedWork> = {
  "checkout-polish": {
    onOrigin: true,
    unpushedCommits: 2,
    uncommittedFiles: 3,
  },
  "empty-cart-state": {
    onOrigin: true,
    unpushedCommits: 0,
    uncommittedFiles: 2,
  },
  "apple-pay-button": {
    onOrigin: false,
    unpushedCommits: 0,
    uncommittedFiles: 0,
  },
  "gift-cards": { onOrigin: false, unpushedCommits: 0, uncommittedFiles: 0 },
}

/** A seeded checkout's git state, or null for a Sandbox the world doesn't seed. */
export function fixtureUnsavedWork(sandboxName: string): UnsavedWork | null {
  return FIXTURE_UNSAVED_WORK[sandboxName] ?? null
}
