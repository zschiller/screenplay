/**
 * The single Room-deletion rule — pure and dependency-free (no React, no DB,
 * no server actions) so each outcome is testable in isolation, mirroring
 * `lib/room-sort`.
 *
 * One function decides what *deleting* a Room means from its membership state:
 * a sole member tears it down; a shared non-owner only leaves; a shared owner
 * tears it down for everyone. Both the single-Room ⋮ delete and (later) the
 * folder cascade route every deletion through this rule, so the behaviour is
 * identical no matter which path triggers it.
 */

/**
 * What a delete resolves to:
 * - `hard-delete`: the deleter is the Room's sole member — full teardown
 *   (Sandbox/terminal/Y.Doc/row), destroying nothing anyone else can see.
 * - `leave`: the deleter is a non-owner of a *shared* Room — remove only their
 *   membership (and their per-user placement, once placements exist); the Room
 *   is untouched for everyone else.
 * - `delete-for-all`: the deleter owns a *shared* Room — full teardown for
 *   everyone, behind a confirm that names the blast radius.
 */
export type RoomDeletionAction = "hard-delete" | "leave" | "delete-for-all"

/**
 * The membership facts the rule decides from. `memberIds` is the Room's full
 * membership — the owner is always among them. When the deleter is absent
 * (e.g. the local build, which has no `room_member` table), they are treated
 * as the sole actor on an unshared Room.
 */
export type RoomMembership = {
  deleterId: string
  ownerId: string
  memberIds: readonly string[]
}

export type RoomDeletionDecision = {
  action: RoomDeletionAction
  /** The deleter owns the Room. */
  isOwner: boolean
  /** The Room is shared with at least one person other than the deleter. */
  isShared: boolean
  /** How many *other* people the Room is shared with — the "N" in the confirm. */
  sharedWithCount: number
}

/**
 * The rule itself, reduced to the two facts it turns on: whether the deleter
 * owns the Room, and how many *other* people it's shared with. Factored out so
 * the folder cascade (#488) can decide a per-Room outcome from the facts it
 * already carries (a `RoomSummary`'s `isOwner` + `sharedWithCount`) without
 * reconstructing a synthetic membership — the same rule, one definition.
 *
 * Not shared → clean teardown. Shared → the owner tears it down for all; a
 * non-owner only removes themselves. (The owner is always a member, so a shared
 * non-owner can never reach a teardown branch.)
 */
export function deletionActionFor(
  isOwner: boolean,
  sharedWithCount: number
): RoomDeletionAction {
  const isShared = sharedWithCount > 0
  return !isShared ? "hard-delete" : isOwner ? "delete-for-all" : "leave"
}

/**
 * Decide the deletion outcome from a Room's membership. Pure: the same
 * membership always yields the same decision, with no I/O.
 */
export function decideRoomDeletion(
  membership: RoomMembership
): RoomDeletionDecision {
  const isOwner = membership.deleterId === membership.ownerId
  const sharedWithCount = membership.memberIds.filter(
    (id) => id !== membership.deleterId
  ).length
  const isShared = sharedWithCount > 0
  const action = deletionActionFor(isOwner, sharedWithCount)

  return { action, isOwner, isShared, sharedWithCount }
}
