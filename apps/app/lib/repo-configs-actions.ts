"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { getConfigs, saveConfigs } from "./repo-configs-store"
import type { RepoConfig } from "./repo-configs.types"

export async function listRepoConfigs(): Promise<RepoConfig[]> {
  const userId = await requireUserId()
  return getConfigs(userId)
}

export async function upsertRepoConfig(
  config: RepoConfig
): Promise<RepoConfig[]> {
  const userId = await requireUserId()
  const list = await getConfigs(userId)

  const duplicate = list.find(
    (c) =>
      c.id !== config.id &&
      c.repoFullName === config.repoFullName &&
      c.name === config.name
  )
  if (duplicate) {
    throw new Error(
      `A preset named "${config.name || "default"}" already exists for ${config.repoFullName}`
    )
  }

  const idx = list.findIndex((c) => c.id === config.id)
  const next: RepoConfig[] =
    idx === -1
      ? [...list, config]
      : list.map((c) => (c.id === config.id ? config : c))

  await saveConfigs(userId, next)

  return next
}

export async function deleteRepoConfig(id: string): Promise<RepoConfig[]> {
  const userId = await requireUserId()
  const list = await getConfigs(userId)
  const next = list.filter((c) => c.id !== id)
  await saveConfigs(userId, next)
  return next
}
