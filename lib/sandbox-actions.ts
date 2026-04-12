"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { Sandbox } from "@vercel/sandbox"
import { storeEnvVars, getEnvVars, deleteEnvVars } from "./env-store"
import { createBranch, renameBranch } from "./github-actions"
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

/**
 * Clone a repo into a new sandbox. Returns the sandbox name on success.
 */
export async function cloneSandbox(
  sandboxName: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
  env?: Record<string, string>,
): Promise<{ success: true; sandboxName: string } | { success: false; error: string }> {
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

    if (env && Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.name, env)
    }

    return { success: true, sandboxName: sandbox.name }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Run the setup script (e.g. npm install) in an existing sandbox.
 */
export async function installDependencies(
  sandboxName: string,
  setupScript?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await sandbox.runCommand(setupCmd, setupArgs)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Start the dev server in an existing sandbox. Returns the preview domain.
 */
export async function startDevServer(
  sandboxName: string,
  port: number = 3000,
  devScript?: string,
): Promise<SandboxResult> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
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

/**
 * Check if a sandbox preview URL is responding with real content.
 * The sandbox proxy may return 200 with an empty/placeholder page before
 * the dev server is actually listening, so we verify the body has content.
 */
export async function probeSandboxUrl(
  url: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "text/html" },
    })
    if (!res.ok) return false
    const body = await res.text()
    // A real dev server response will contain HTML markup.
    // Proxy placeholders / blank pages won't have a <body> or <div> tag.
    return body.includes("<body") || body.includes("<div")
  } catch {
    return false
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

/**
 * Fork a sandbox by snapshotting it and creating a new sandbox from that snapshot.
 * Preserves the full filesystem (uncommitted changes, node_modules, etc.).
 */
export async function forkSandbox(
  sourceSandboxName: string,
  newSandboxName: string,
  newBranch: string,
  port: number = 3000,
  devScript?: string,
  env?: Record<string, string>,
): Promise<SandboxResult> {
  try {
    const source = await Sandbox.get({ name: sourceSandboxName, resume: false })
    const snap = await source.snapshot()

    // Resume the source sandbox and restart its dev server (snapshot stopped it)
    const sourceEnv = await getEnvVars(sourceSandboxName)
    const resumedSource = await Sandbox.get({ name: sourceSandboxName })
    const dev = devScript?.trim() || "npm run dev"
    const [devCmd, ...devArgs] = dev.split(/\s+/)
    await resumedSource.runCommand({
      cmd: devCmd,
      args: devArgs,
      detached: true,
      ...(sourceEnv ? { env: sourceEnv } : {}),
    })

    // Create new sandbox from snapshot
    const sandbox = await Sandbox.create({
      name: newSandboxName,
      source: { type: "snapshot", snapshotId: snap.snapshotId },
      ports: [port],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    })

    // Switch to the new branch
    await sandbox.runCommand("git", ["checkout", "-b", newBranch])

    if (env && Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.name, env)
    }

    return {
      sandboxName: sandbox.name,
      previewDomain: sandbox.domain(port),
      status: "running",
    }
  } catch (e) {
    return {
      sandboxName: newSandboxName,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function removeSandboxEnv(sandboxName: string): Promise<void> {
  await deleteEnvVars(sandboxName)
}

/**
 * Step 1: Create a Git branch on GitHub for the agent.
 */
export async function createAgentBranch(
  workspace: WorkspaceData,
  branchName: string,
  fromBranch?: string,
): Promise<{ success: boolean; error?: string }> {
  return createBranch(
    workspace.repoOwner,
    workspace.repoName,
    branchName,
    fromBranch || workspace.defaultBranch,
  )
}

/**
 * Rename a branch in the sandbox and on GitHub (if it exists remotely).
 */
export async function renameAgentBranch(
  workspace: WorkspaceData,
  sandboxName: string,
  oldBranch: string,
  newBranch: string,
): Promise<{ success: boolean; error?: string }> {
  // Rename locally in the sandbox first — this always works
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    await sandbox.runCommand("git", ["branch", "-m", newBranch])
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }

  // Attempt GitHub rename — may not exist remotely yet (e.g. forked sandboxes)
  const result = await renameBranch(
    workspace.repoOwner,
    workspace.repoName,
    oldBranch,
    newBranch,
  )
  if (!result.success) {
    // Branch doesn't exist on GitHub yet — that's fine, it'll be pushed with the new name
    console.log(`GitHub branch rename skipped (${result.error}), will push as ${newBranch}`)
  }

  return { success: true }
}

function getWorkspaceEnv(envVarsText: string): Record<string, string> | undefined {
  const env = parseEnvVars(envVarsText)
  return Object.keys(env).length > 0 ? env : undefined
}

/**
 * Step 3: Configure git auth and identity so the agent can push commits.
 * Also ensures we're on the correct branch (not detached HEAD) since
 * Sandbox.create with revision may leave HEAD detached.
 */
export async function configureAgentGit(
  sandboxName: string,
  workspace: WorkspaceData,
  branch: string,
): Promise<{ success: boolean; error?: string }> {
  const ghToken = await getGitHubToken()
  if (!ghToken) {
    return { success: false, error: "No GitHub token available — the user may need to re-authenticate with GitHub." }
  }

  const sandbox = await Sandbox.get({ name: sandboxName, resume: false })

  // Ensure we're on the actual branch, not a detached HEAD.
  // Sandbox.create with `revision` may check out the commit directly.
  await sandbox.runCommand("git", ["checkout", "-B", branch])
  await sandbox.runCommand("git", ["branch", "--set-upstream-to", `origin/${branch}`, branch])

  const setUrl = await sandbox.runCommand("git", [
    "remote",
    "set-url",
    "origin",
    `https://x-access-token:${ghToken}@github.com/${workspace.repoOwner}/${workspace.repoName}.git`,
  ])
  if (setUrl.exitCode !== 0) {
    return { success: false, error: `Failed to set git remote URL (exit ${setUrl.exitCode})` }
  }

  await sandbox.runCommand("git", ["config", "user.email", "agent@screenplay.dev"])
  await sandbox.runCommand("git", ["config", "user.name", "Screenplay Agent"])
  await sandbox.runCommand("git", ["config", "push.default", "current"])

  return { success: true }
}
