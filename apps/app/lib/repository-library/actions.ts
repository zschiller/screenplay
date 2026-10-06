"use server"

import { hasFixtureFault } from "@/lib/fixture-faults"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { library } from "./server"

/** Your Repositories (Settings › Repositories). */
export async function listRepositories(): Promise<RepoConfig[]> {
  const repositories = await library()
  if (await hasFixtureFault("no-presets")) return []
  return repositories.list()
}

/** Create or update one of your Repositories; returns the new list. */
export async function saveRepository(
  repository: RepoConfig
): Promise<RepoConfig[]> {
  return (await library()).save(repository)
}

/** Save a Canvas edit to one of your Repositories and every Canvas using it,
 *  clearing their customizations; returns the new list. */
export async function saveRepositoryToAll(
  repository: RepoConfig
): Promise<RepoConfig[]> {
  return (await library()).saveToAll(repository)
}

/** How many of your Canvases use one of your Repositories (the delete
 *  confirm's count). */
export async function repositoryCanvasCount(
  repositoryId: string
): Promise<number> {
  return (await library()).canvasCount(repositoryId)
}

/** How many of your Canvases use each of your Repositories, by id, for
 *  Settings' "On N canvases". Empty on hosted, where canvases keep their own
 *  copy. */
export async function repositoryCanvasCounts(): Promise<
  Record<string, number>
> {
  return (await library()).canvasCounts()
}

/** Delete one of your Repositories; returns the new list. Canvases using it
 *  keep their copy, unlinked. */
export async function deleteRepository(
  repositoryId: string
): Promise<RepoConfig[]> {
  return (await library()).delete(repositoryId)
}
