"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { Sandbox } from "@vercel/sandbox"
import { storeEnvVars, getEnvVars, deleteEnvVars } from "./env-store"
import { createBranch } from "./github-actions"
import type { WorkspaceData } from "./liveblocks.types"

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

function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) env[key] = value
  }
  return env
}

export async function createSandbox(
  sandboxName: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
  env?: Record<string, string>,
  setupScript?: string,
  devScript?: string,
): Promise<SandboxResult> {
  try {
    const ghToken = await getGitHubToken()

    const sandbox = await Sandbox.create({
      name: sandboxName,
      source: ghToken
        ? {
            type: "git",
            url: gitUrl,
            revision: branch,
            username: "x-access-token",
            password: ghToken,
          }
        : {
            type: "git",
            url: gitUrl,
            revision: branch,
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

    // Run setup script (defaults to npm install)
    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await sandbox.runCommand(setupCmd, setupArgs)

    // Run dev script (defaults to npm run dev)
    const dev = devScript?.trim() || "npm run dev"
    const [devCmd, ...devArgs] = dev.split(/\s+/)
    await sandbox.runCommand({
      cmd: devCmd,
      args: devArgs,
      detached: true,
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
  setupScript?: string,
  devScript?: string,
): Promise<SandboxResult> {
  try {
    const safeEnv = await getEnvVars(sandboxName)

    // Sandbox.get auto-resumes stopped persistent sandboxes
    const sandbox = await Sandbox.get({ name: sandboxName })

    await sandbox.runCommand("git", ["pull", "origin", branch])

    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await sandbox.runCommand(setupCmd, setupArgs)

    const dev = devScript?.trim() || "npm run dev"
    const [devCmd, ...devArgs] = dev.split(/\s+/)
    await sandbox.runCommand({
      cmd: devCmd,
      args: devArgs,
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

export async function createAgentSandbox(
  sandboxName: string,
  branchName: string,
  workspace: WorkspaceData,
  fromBranch?: string,
): Promise<SandboxResult> {
  // Create branch on GitHub — fork from an existing agent's branch or the default
  const branchResult = await createBranch(
    workspace.repoOwner,
    workspace.repoName,
    branchName,
    fromBranch || workspace.defaultBranch,
  )

  if (!branchResult.success) {
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: branchResult.error || "Failed to create branch",
    }
  }

  // Parse env vars from workspace config
  const env = parseEnvVars(workspace.envVars)

  // Create sandbox on the new branch with workspace config
  const result = await createSandbox(
    sandboxName,
    workspace.cloneUrl,
    branchName,
    3000,
    Object.keys(env).length > 0 ? env : undefined,
    workspace.setupScript,
    workspace.devScript,
  )

  if (result.status !== "running") {
    return result
  }

  // Configure git auth and identity so the agent can push
  try {
    const ghToken = await getGitHubToken()
    const sandbox = await Sandbox.get({ name: result.sandboxName, resume: false })

    if (ghToken) {
      await sandbox.runCommand("git", [
        "remote",
        "set-url",
        "origin",
        `https://x-access-token:${ghToken}@github.com/${workspace.repoOwner}/${workspace.repoName}.git`,
      ])
    }
    await sandbox.runCommand("git", ["config", "user.email", "agent@screenplay.dev"])
    await sandbox.runCommand("git", ["config", "user.name", "Screenplay Agent"])
  } catch {
    // Non-fatal — agent may not be able to push but sandbox still works
  }

  return result
}
