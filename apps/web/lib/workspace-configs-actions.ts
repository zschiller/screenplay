"use server"

import { requireUserId } from "@/lib/auth-server"
import { getConfigs, saveConfigs } from "./workspace-configs-store"
import type { WorkspaceConfig } from "./workspace-configs.types"

export async function listWorkspaceConfigs(): Promise<WorkspaceConfig[]> {
  const userId = await requireUserId()
  return getConfigs(userId)
}

export async function upsertWorkspaceConfig(
  config: WorkspaceConfig,
): Promise<WorkspaceConfig[]> {
  const userId = await requireUserId()
  const list = await getConfigs(userId)

  const duplicate = list.find(
    (c) =>
      c.id !== config.id &&
      c.repoFullName === config.repoFullName &&
      c.name === config.name,
  )
  if (duplicate) {
    throw new Error(
      `A configuration named "${config.name || "default"}" already exists for ${config.repoFullName}`,
    )
  }

  const idx = list.findIndex((c) => c.id === config.id)
  const next: WorkspaceConfig[] =
    idx === -1 ? [...list, config] : list.map((c) => (c.id === config.id ? config : c))

  await saveConfigs(userId, next)
  return next
}

export async function deleteWorkspaceConfig(
  id: string,
): Promise<WorkspaceConfig[]> {
  const userId = await requireUserId()
  const list = await getConfigs(userId)
  const next = list.filter((c) => c.id !== id)
  await saveConfigs(userId, next)
  return next
}
