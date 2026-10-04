"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { openRoom } from "@/lib/room-access"

import { accountSkills } from "./account"
import { canvasSkills } from "./canvas"
import { appSkills, hasSkill } from "./index"
import {
  prepareSkill,
  type OpenedSkill,
  type SavedSkill,
  type SavedSkills,
  type SkillFile,
} from "./saved"

/**
 * Read one of the canvas's Skills for Open. Any member may; a non-member is
 * refused before the doc is read.
 */
export async function readCanvasSkill(
  roomId: string,
  name: string
): Promise<OpenedSkill> {
  const read = await canvasSkills(await openRoom(roomId)).read(name)
  if (!read.ok) throw new Error(read.error)
  return { content: read.value.content, files: read.value.files }
}

/**
 * Delete one of the canvas's Skills, with everything in its folder. Viewers
 * can't; the list updates live from the Room's doc.
 */
export async function deleteCanvasSkill(
  roomId: string,
  name: string
): Promise<void> {
  const room = await openRoom(roomId)
  if (room.role === "viewer") {
    throw new Error("Viewers can’t delete skills on this canvas.")
  }
  const removed = await canvasSkills(room).remove(name)
  if (!removed.ok) throw new Error(removed.error)
}

/** Your Account Skills (Settings › Skills, #1558), by name. */
export async function listAccountSkills(): Promise<SavedSkill[]> {
  return accountSkills(await requireUserId()).list()
}

/** Read one of your Account Skills for Open. */
export async function readAccountSkill(name: string): Promise<OpenedSkill> {
  const read = await accountSkills(await requireUserId()).read(name)
  if (!read.ok) throw new Error(read.error)
  return { content: read.value.content, files: read.value.files }
}

/** Delete one of your Account Skills, with everything in its folder. */
export async function deleteAccountSkill(name: string): Promise<void> {
  const removed = await accountSkills(await requireUserId()).remove(name)
  if (!removed.ok) throw new Error(removed.error)
}

/** Where a chat's skill card (`save_skill`) can save to. */
export type SkillSaveScope = "account" | "canvas"

/** A Skill a chat offered for saving: the `save_skill` call's arguments. */
export interface OfferedSkill {
  name: string
  content: string
  files?: SkillFile[]
}

/** An offered Skill with the files of the App Skill it replaces that it keeps. */
const withAppSkill = (offered: OfferedSkill): OfferedSkill => ({
  ...offered,
  files: appSkills.carryFiles(offered.name, offered.files).files,
})

/**
 * What a chat's skill card shows (#1633): whether the offered Skill is valid,
 * where it's already saved as it is now (so the card reads Saved after a
 * reload and for other members), and whether it would take the place of a
 * Built in Skill.
 */
export async function offeredSkillState(
  roomId: string,
  offered: OfferedSkill
): Promise<
  | { ok: false; error: string }
  | { ok: true; savedTo: SkillSaveScope | null; replacesBuiltIn: boolean }
> {
  const prepared = prepareSkill(withAppSkill(offered))
  if (!prepared.ok) return prepared
  const room = await openRoom(roomId)
  const same = async (scope: SavedSkills) => {
    const read = await scope.read(offered.name).catch(() => null)
    return !!read?.ok && read.value.content === prepared.value.content
  }
  const savedTo = (await same(accountSkills(room.userId)))
    ? "account"
    : (await same(canvasSkills(room)))
      ? "canvas"
      : null
  const replacesBuiltIn =
    hasSkill(offered.name) || hasSkill(offered.name, "coordinator")
  return { ok: true, savedTo, replacesBuiltIn }
}

/**
 * Save a Skill a chat offered, from its card's Save to account or Save to
 * canvas. The person who presses is its author; viewers can't save to the
 * canvas.
 */
export async function saveOfferedSkill(
  roomId: string,
  scope: SkillSaveScope,
  offered: OfferedSkill
): Promise<void> {
  const room = await openRoom(roomId)
  if (scope === "canvas" && room.role === "viewer") {
    throw new Error("Viewers can’t save skills to this canvas.")
  }
  const target =
    scope === "account" ? accountSkills(room.userId) : canvasSkills(room)
  const saved = await target.save({
    ...withAppSkill(offered),
    author: { addedBy: "member", addedById: room.userId },
  })
  if (!saved.ok) throw new Error(saved.error)
}
