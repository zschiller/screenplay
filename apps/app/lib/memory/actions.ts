"use server"

import { requireUserId } from "@/lib/auth-helpers"
import type { MemoryData } from "@/lib/types"
import {
  addAccountMemory,
  editAccountMemory,
  readAccountMemory,
  removeAccountMemory,
} from "./account"
import { kvAccountMemoryStore } from "./account-store"

async function store() {
  return kvAccountMemoryStore(await requireUserId())
}

/** Your account memory (Settings › Memory), oldest first. */
export async function listAccountMemory(): Promise<MemoryData[]> {
  return readAccountMemory(await store())
}

/** Add an entry yourself; returns the new list. */
export async function addAccountMemoryEntry(
  text: string
): Promise<MemoryData[]> {
  const s = await store()
  await addAccountMemory(s, { text, source: "member" })
  return readAccountMemory(s)
}

/** Change an entry's text; returns the new list. */
export async function editAccountMemoryEntry(
  id: string,
  text: string
): Promise<MemoryData[]> {
  const s = await store()
  await editAccountMemory(s, id, { text })
  return readAccountMemory(s)
}

/** Delete an entry; returns the new list. */
export async function removeAccountMemoryEntry(
  id: string
): Promise<MemoryData[]> {
  const s = await store()
  await removeAccountMemory(s, id)
  return readAccountMemory(s)
}
