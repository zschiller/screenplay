"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { Sandbox } from "@vercel/sandbox"
import { storeEnvVars, getEnvVars, deleteEnvVars } from "./env-store"

// 5 hours in ms (max for Pro plan)
const SANDBOX_TIMEOUT = 5 * 60 * 60 * 1000

export interface SandboxResult {
  sandboxId: string
  previewDomain: string
  status: "running" | "error"
  error?: string
}

async function getGitHubToken(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  const token = tokens.data?.[0]?.token
  return token ?? null
}


export async function createSandbox(
  gitUrl: string,
  branch: string,
  port: number = 3000,
  env?: Record<string, string>,
): Promise<SandboxResult> {
  try {
    const ghToken = await getGitHubToken()
    const safeEnv = env

    const sandbox = await Sandbox.create({
      source: ghToken
        ? {
            type: "git",
            url: gitUrl,
            revision: branch,
            depth: 1,
            username: "x-access-token",
            password: ghToken,
          }
        : {
            type: "git",
            url: gitUrl,
            revision: branch,
            depth: 1,
          },
      ports: [port],
      timeout: SANDBOX_TIMEOUT,
      ...(safeEnv && Object.keys(safeEnv).length > 0 ? { env: safeEnv } : {}),
    })

    // Persist env vars encrypted in Redis for restarts
    if (env && Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.sandboxId, env)
    }

    await sandbox.runCommand("npm", ["install"])

    await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      detached: true,
    })

    return {
      sandboxId: sandbox.sandboxId,
      previewDomain: sandbox.domain(port),
      status: "running",
    }
  } catch (e) {
    return {
      sandboxId: "",
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function reconnectSandbox(
  sandboxId: string,
  port: number = 3000,
): Promise<SandboxResult> {
  try {
    const sandbox = await Sandbox.get({ sandboxId })
    if (sandbox.status === "running") {
      return {
        sandboxId: sandbox.sandboxId,
        previewDomain: sandbox.domain(port),
        status: "running",
      }
    }
    return {
      sandboxId,
      previewDomain: "",
      status: "error",
      error: `Sandbox is ${sandbox.status}`,
    }
  } catch (e) {
    return {
      sandboxId,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Try to restart an existing sandbox. If it's stopped/failed,
 * create a fresh one from the same git source.
 */
export async function restartSandbox(
  sandboxId: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
): Promise<SandboxResult> {
  try {
    const ghToken = await getGitHubToken()
    const safeEnv = await getEnvVars(sandboxId)

    // Check if old sandbox is still alive
    let sandbox: Awaited<ReturnType<typeof Sandbox.get>> | null = null
    try {
      sandbox = await Sandbox.get({ sandboxId })
    } catch {
      // sandbox gone, will recreate
    }

    if (sandbox && sandbox.status === "running") {
      // Still running — just pull latest and restart dev server
      await sandbox.runCommand("git", ["pull", "origin", branch])
      await sandbox.runCommand("npm", ["install"])
      await sandbox.runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        detached: true,
        ...(safeEnv ? { env: safeEnv } : {}),
      })
      return {
        sandboxId: sandbox.sandboxId,
        previewDomain: sandbox.domain(port),
        status: "running",
      }
    }

    // Sandbox is stopped/failed/gone — create a fresh one
    const newSandbox = await Sandbox.create({
      source: ghToken
        ? {
            type: "git",
            url: gitUrl,
            revision: branch,
            depth: 1,
            username: "x-access-token",
            password: ghToken,
          }
        : {
            type: "git",
            url: gitUrl,
            revision: branch,
            depth: 1,
          },
      ports: [port],
      timeout: SANDBOX_TIMEOUT,
      ...(safeEnv && Object.keys(safeEnv).length > 0 ? { env: safeEnv } : {}),
    })

    // Migrate env vars to new sandbox ID
    if (safeEnv) {
      await deleteEnvVars(sandboxId)
      await storeEnvVars(newSandbox.sandboxId, safeEnv)
    }

    await newSandbox.runCommand("npm", ["install"])
    await newSandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      detached: true,
    })

    return {
      sandboxId: newSandbox.sandboxId,
      previewDomain: newSandbox.domain(port),
      status: "running",
    }
  } catch (e) {
    return {
      sandboxId,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function removeSandboxEnv(sandboxId: string): Promise<void> {
  await deleteEnvVars(sandboxId)
}
