import { Sandbox } from "@vercel/sandbox"
import type {
  CustomToolName,
  ReadFileInput,
  WriteFileInput,
  EditFileInput,
  RunCommandInput,
  ListFilesInput,
  PushToGithubInput,
} from "./types"

export async function executeCustomTool(
  sandboxName: string,
  toolName: CustomToolName,
  toolInput: Record<string, unknown>,
  githubToken?: string | null,
): Promise<string> {
  const sandbox = await Sandbox.get({ name: sandboxName })

  switch (toolName) {
    case "read_file":
      return readFile(sandbox, toolInput as unknown as ReadFileInput)
    case "write_file":
      return writeFile(sandbox, toolInput as unknown as WriteFileInput)
    case "edit_file":
      return editFile(sandbox, toolInput as unknown as EditFileInput)
    case "run_command":
      return runCommand(sandbox, toolInput as unknown as RunCommandInput)
    case "list_files":
      return listFiles(sandbox, toolInput as unknown as ListFilesInput)
    case "push_to_github":
      return pushToGithub(sandbox, toolInput as unknown as PushToGithubInput, githubToken)
    default:
      return `Unknown tool: ${toolName}`
  }
}

async function readFile(
  sandbox: Sandbox,
  input: ReadFileInput,
): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path: input.path })
  if (!buf) return `File not found: ${input.path}`
  return buf.toString("utf-8")
}

async function writeFile(
  sandbox: Sandbox,
  input: WriteFileInput,
): Promise<string> {
  await sandbox.writeFiles([{ path: input.path, content: input.content }])
  return `Written ${input.content.length} bytes to ${input.path}`
}

async function editFile(
  sandbox: Sandbox,
  input: EditFileInput,
): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path: input.path })
  if (!buf) return `File not found: ${input.path}`

  const content = buf.toString("utf-8")
  if (!content.includes(input.old_string)) {
    return `old_string not found in ${input.path}. Make sure it matches exactly including whitespace.`
  }

  const updated = content.replace(input.old_string, input.new_string)
  await sandbox.writeFiles([{ path: input.path, content: updated }])
  return `Edited ${input.path}: replaced ${input.old_string.length} chars with ${input.new_string.length} chars`
}

async function runCommand(
  sandbox: Sandbox,
  input: RunCommandInput,
): Promise<string> {
  // The model may send the full command as a single string (e.g. "git push origin HEAD")
  // or split it into command + args. Handle both.
  let cmd: string
  let args: string[]
  if (input.args && input.args.length > 0) {
    cmd = input.command
    args = input.args
  } else {
    const parts = input.command.split(/\s+/)
    cmd = parts[0]
    args = parts.slice(1)
  }
  const result = await sandbox.runCommand(cmd, args)
  const parts: string[] = []
  const stdout = await result.stdout()
  const stderr = await result.stderr()
  if (stdout) parts.push(`stdout:\n${stdout}`)
  if (stderr) parts.push(`stderr:\n${stderr}`)
  parts.push(`exit code: ${result.exitCode}`)
  return parts.join("\n\n")
}

async function listFiles(
  sandbox: Sandbox,
  input: ListFilesInput,
): Promise<string> {
  const path = input.path || "."
  const args = [path, "-maxdepth", "3", "-type", "f"]
  if (input.pattern) {
    args.push("-name", input.pattern)
  }
  // Exclude node_modules and .git
  args.push("!", "-path", "*/node_modules/*", "!", "-path", "*/.git/*")
  const result = await sandbox.runCommand("find", args)
  const stdout = await result.stdout()
  return stdout || "(no files found)"
}

async function pushToGithub(
  sandbox: Sandbox,
  input: PushToGithubInput,
  githubToken?: string | null,
): Promise<string> {
  if (!githubToken) {
    return "Error: No GitHub token available. The user may need to re-authenticate with GitHub."
  }

  // Get the current remote URL to extract owner/repo
  const urlResult = await sandbox.runCommand("git", ["remote", "get-url", "origin"])
  const remoteUrl = (await urlResult.stdout()).trim()
  if (urlResult.exitCode !== 0 || !remoteUrl) {
    return "Error: Could not determine git remote URL. Is this a git repository?"
  }

  // Extract owner/repo from the remote URL (handles both HTTPS and token-embedded URLs)
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/)
  if (!match) {
    return `Error: Could not parse GitHub owner/repo from remote URL: ${remoteUrl}`
  }
  const [, owner, repo] = match

  // Set remote URL with fresh token for authentication
  const authedUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`
  await sandbox.runCommand("git", ["remote", "set-url", "origin", authedUrl])

  // Push to the current branch
  const pushResult = await sandbox.runCommand("git", ["push", "origin", "HEAD"])
  const pushStdout = await pushResult.stdout()
  const pushStderr = await pushResult.stderr()

  // Remove token from remote URL after push (don't leave credentials in config)
  const cleanUrl = `https://github.com/${owner}/${repo}.git`
  await sandbox.runCommand("git", ["remote", "set-url", "origin", cleanUrl])

  if (pushResult.exitCode !== 0) {
    return `Push failed (exit code ${pushResult.exitCode}):\n${pushStderr || pushStdout}`
  }

  const output = pushStderr || pushStdout || ""
  return `Successfully pushed to GitHub.\n${output}`.trim()
}
