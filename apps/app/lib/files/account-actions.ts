"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { accountFiles } from "@/lib/files"
import type { FileEntryData } from "@/lib/types"

/** Your Account Files (Settings › Files, #1521), by path. */
export async function listAccountFiles(): Promise<FileEntryData[]> {
  const listed = await accountFiles(await requireUserId()).list()
  if (!listed.ok) throw new Error(listed.error)
  return listed.value
}
