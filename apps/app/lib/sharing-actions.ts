"use server"

import { getUserId } from "@/lib/auth-helpers"
import { viewers } from "@/lib/capabilities"
import { sharePath } from "@/server/share-link.mjs"
import { getSharing } from "@/server/sharing.mjs"

/** Sharing as the owner's Share dialog shows it, for one canvas (#1953). */
export interface SharingView {
  /** False where nothing serves viewers: Hosted, Headless, `next dev`. */
  available: boolean
  on: boolean
  /** This canvas's link while Sharing is on. */
  link: string | null
  /** Why Sharing last failed to turn on. */
  error: string | null
}

/**
 * The host's own calls only: a viewer listener refuses every server action
 * before the app sees it, and Hosted has no Sharing to show.
 */
async function sharing() {
  if (!viewers) return undefined
  if (!(await getUserId())) throw new Error("Unauthorized")
  return getSharing()
}

function view(
  state: { on: boolean; origin: string | null; error: string | null },
  roomId: string
): SharingView {
  const path = sharePath(roomId)
  return {
    available: true,
    on: state.on,
    link: state.on && state.origin && path ? `${state.origin}${path}` : null,
    error: state.error,
  }
}

const UNAVAILABLE: SharingView = {
  available: false,
  on: false,
  link: null,
  error: null,
}

/** Whether Sharing is on, and this canvas's link while it is. */
export async function getSharingView(roomId: string): Promise<SharingView> {
  const found = await sharing()
  return found ? view(found.state(), roomId) : UNAVAILABLE
}

/**
 * Turn Sharing on or off for the whole Mac. Off closes the viewer listener
 * and releases everything it exposed.
 */
export async function setSharingOn(
  roomId: string,
  on: boolean
): Promise<SharingView> {
  const found = await sharing()
  return found ? view(await found.set(on), roomId) : UNAVAILABLE
}
