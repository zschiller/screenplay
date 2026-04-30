"use server"

import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator"
import { requireUserId } from "@/lib/auth-helpers"
import { createBranch } from "./github-actions"
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
  const isNew = idx === -1
  const next: WorkspaceConfig[] =
    isNew ? [...list, config] : list.map((c) => (c.id === config.id ? config : c))

  await saveConfigs(userId, next)

  if (isNew) {
    const branchName = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
    })
    const result = await createBranch(
      config.repoOwner,
      config.repoName,
      branchName,
      config.defaultBranch,
    )
    if (!result.success) {
      console.warn(
        `Failed to auto-generate branch ${branchName} for ${config.repoFullName}: ${result.error}`,
      )
    }
  }

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
