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

  // Idempotent upsert (PRD #673, save-as-preset slice #680): re-saving a preset
  // for a `(repoFullName + name)` that already exists updates it in place rather
  // than throwing on the duplicate, so the add modal's best-effort "save these
  // settings" can stay checked without ever failing a re-add. An explicit id
  // match (editing a specific preset) wins; otherwise fall back to the identity
  // key. The matched preset's own id and createdAt are preserved.
  const target =
    list.find((c) => c.id === config.id) ??
    list.find(
      (c) => c.repoFullName === config.repoFullName && c.name === config.name
    )

  const next: RepoConfig[] = target
    ? list.map((c) =>
        c.id === target.id
          ? { ...config, id: target.id, createdAt: target.createdAt }
          : c
      )
    : [...list, config]

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
