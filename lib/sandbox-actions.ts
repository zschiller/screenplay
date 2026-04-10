"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { Sandbox } from "@vercel/sandbox"
import { nanoid } from "nanoid"
import { storeEnvVars, getEnvVars, deleteEnvVars } from "./env-store"

// 5 hours in ms (max for Pro plan)
const SANDBOX_TIMEOUT = 5 * 60 * 60 * 1000
// 7 days in ms
const SNAPSHOT_EXPIRATION = 7 * 24 * 60 * 60 * 1000

export interface SandboxResult {
  sandboxName: string
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
    const name = `sp-${nanoid(10)}`

    const sandbox = await Sandbox.create({
      name,
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
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    })

    // Persist env vars encrypted in Redis for restarts
    if (env && Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.name, env)
    }

    await sandbox.runCommand("npm", ["install"])

    await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      detached: true,
    })

    return {
      sandboxName: sandbox.name,
      previewDomain: sandbox.domain(port),
      status: "running",
    }
  } catch (e) {
    return {
      sandboxName: "",
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function reconnectSandbox(
  sandboxName: string,
  port: number = 3000,
): Promise<SandboxResult> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    if (sandbox.status === "running") {
      return {
        sandboxName: sandbox.name,
        previewDomain: sandbox.domain(port),
        status: "running",
      }
    }
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: `Sandbox is ${sandbox.status}`,
    }
  } catch (e) {
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Restart a persistent sandbox. Auto-resume handles stopped sandboxes —
 * no need to recreate from scratch.
 */
export async function restartSandbox(
  sandboxName: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
): Promise<SandboxResult> {
  try {
    const safeEnv = await getEnvVars(sandboxName)

    // Sandbox.get auto-resumes stopped persistent sandboxes
    const sandbox = await Sandbox.get({ name: sandboxName })

    await sandbox.runCommand("git", ["pull", "origin", branch])
    await sandbox.runCommand("npm", ["install"])
    await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      detached: true,
      ...(safeEnv ? { env: safeEnv } : {}),
    })

    return {
      sandboxName: sandbox.name,
      previewDomain: sandbox.domain(port),
      status: "running",
    }
  } catch (e) {
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function removeSandboxEnv(sandboxName: string): Promise<void> {
  await deleteEnvVars(sandboxName)
}
