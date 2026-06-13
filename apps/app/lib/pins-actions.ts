"use server"

import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import {
  listPinsForUser,
  pinRoom as pinRoomRecord,
  unpin as unpinRecord,
  type PinKind,
  type PinRecord,
} from "@/lib/pins"

// Server actions over pins, mirroring `lib/folders-actions`. Every action gates
// on `requireUserId` and scopes to that user, so pins stay private per user
// (PRD #507). Works unchanged on the local build, where `requireUserId`
// resolves to the single seeded local user who owns every pin.

export type { PinKind }

// The client-facing shape of a pin: its `kind`, the id of the Room or Folder it
// points at, and its `position` in the user's list. The pin's own row id stays
// server-side — the sidebar addresses a pin by its target, never its id.
export type PinSummary = {
  kind: PinKind
  targetId: string
  position: number
}

function toSummary(pin: PinRecord): PinSummary {
  return { kind: pin.kind, targetId: pin.targetId, position: pin.position }
}

export async function listPins(): Promise<PinSummary[]> {
  const userId = await requireUserId()
  const pins = await listPinsForUser(userId)
  return pins.map(toSummary)
}

// Pin a Room to the current user's sidebar (appends to the end). Idempotent —
// re-pinning a Room already pinned returns the existing pin. Pinning is offered
// to any user who can see the Room, owner or collaborator, since a pin is
// per-user and never changes anyone else's sidebar.
export async function pinRoom(roomId: string): Promise<PinSummary> {
  const userId = await requireUserId()
  const pin = await pinRoomRecord({ id: nanoid(10), userId, roomId })
  return toSummary(pin)
}

// Unpin a target from the current user's sidebar. Scoped to the caller, so it
// can only ever remove their own pin.
export async function unpin(kind: PinKind, targetId: string): Promise<void> {
  const userId = await requireUserId()
  await unpinRecord({ userId, kind, targetId })
}
