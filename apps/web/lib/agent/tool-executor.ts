import { sandboxProvider } from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"

/** Max characters to keep from command stdout/stderr to avoid bloating session history */
const MAX_OUTPUT_LENGTH = 20_000

import type {
  CustomToolName,
  ReadFileInput,
  WriteFileInput,
  EditFileInput,
  RunCommandInput,
  ListFilesInput,
  CreatePrInput,
  ReadSkillInput,
} from "./types"
import { redactSensitiveInfo } from "./redact"
import { createGitHubPr } from "@/lib/github-pr"
import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { getSkill, getSkillIndex } from "@/lib/skills"

export interface ToolContext {
  sandboxName: string
  roomId: string
  userId: string
}

export async function executeCustomTool(
  ctx: ToolContext,
  toolName: CustomToolName,
  toolInput: Record<string, unknown>,
): Promise<string> {
  let result: string
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "run_command":
    case "list_files": {
      const sandbox = await sandboxProvider.get({ name: ctx.sandboxName })
      switch (toolName) {
        case "read_file":
          result = await readFile(sandbox, toolInput as unknown as ReadFileInput)
          break
        case "write_file":
          result = await writeFile(sandbox, toolInput as unknown as WriteFileInput)
          break
        case "edit_file":
          result = await editFile(sandbox, toolInput as unknown as EditFileInput)
          break
        case "run_command":
          result = await runCommand(sandbox, toolInput as unknown as RunCommandInput, ctx)
          break
        case "list_files":
          result = await listFiles(sandbox, toolInput as unknown as ListFilesInput)
          break
      }
      break
    }
    case "create_pr":
      result = await createPr(ctx, toolInput as unknown as CreatePrInput)
      break
    case "read_skill":
      result = readSkill(toolInput as unknown as ReadSkillInput)
      break
    default:
      result = `Unknown tool: ${toolName}`
  }
  // Anthropic API requires tool result text to be at least 1 character
  return result || "(empty)"
}

/**
 * Look up the acting user's GitHub token and hand it to the next
 * runCommand as SCREENPLAY_GH_TOKEN. The in-sandbox credential helper
 * feeds it to git, so every push from this turn is attributed to
 * whichever collaborator triggered the command — not to whoever first
 * provisioned the (shared) sandbox.
 */
async function buildAgentGitEnv(ctx: ToolContext): Promise<Record<string, string> | undefined> {
  try {
    const token = await getGitHubTokenForUser(ctx.userId)
    return token ? { SCREENPLAY_GH_TOKEN: token } : undefined
  } catch {
    return undefined
  }
}

async function createPr(
  ctx: ToolContext,
  input: CreatePrInput,
): Promise<string> {
  try {
    const { url, number } = await createGitHubPr({
      userId: ctx.userId,
      roomId: ctx.roomId,
      sandboxName: ctx.sandboxName,
      title: input.title,
      body: input.body,
    })
    return `Created PR #${number}: ${url}`
  } catch (e) {
    return `Failed to create PR: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function readFile(
  sandbox: SandboxInstance,
  input: ReadFileInput,
): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path: input.path })
  if (!buf) return `File not found: ${input.path}`
  return buf.toString("utf-8")
}

async function writeFile(
  sandbox: SandboxInstance,
  input: WriteFileInput,
): Promise<string> {
  await sandbox.writeFiles([{ path: input.path, content: input.content }])
  return `Written ${input.content.length} bytes to ${input.path}`
}

async function editFile(
  sandbox: SandboxInstance,
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

/**
 * Parse a command string respecting quoted substrings.
 * e.g. `git commit -m "fix button color"` → ["git", "commit", "-m", "fix button color"]
 */
function parseCommandString(command: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote: string | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

/** Characters that indicate the command needs a shell to interpret it */
const SHELL_OPERATORS = /[&&|;><$`(){}]/

async function runCommand(
  sandbox: SandboxInstance,
  input: RunCommandInput,
  ctx: ToolContext,
): Promise<string> {
  let cmd: string
  let args: string[]

  if (input.args && input.args.length > 0) {
    // Explicit args array — use as-is
    cmd = input.command
    args = input.args
  } else if (SHELL_OPERATORS.test(input.command)) {
    // Command contains shell operators (&&, |, etc.) — run through sh -c
    cmd = "sh"
    args = ["-c", input.command]
  } else {
    // Simple command string — parse respecting quotes
    const tokens = parseCommandString(input.command)
    cmd = tokens[0]
    args = tokens.slice(1)
  }

  const gitEnv = await buildAgentGitEnv(ctx)
  const result = await sandbox.runCommand({
    cmd,
    args,
    ...(gitEnv ? { env: gitEnv } : {}),
  })
  const parts: string[] = []
  let stdout = redactSensitiveInfo(await result.stdout())
  let stderr = redactSensitiveInfo(await result.stderr())
  if (stdout) {
    if (stdout.length > MAX_OUTPUT_LENGTH) {
      stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + `\n...(truncated ${stdout.length - MAX_OUTPUT_LENGTH} chars)`
    }
    parts.push(`stdout:\n${stdout}`)
  }
  if (stderr) {
    if (stderr.length > MAX_OUTPUT_LENGTH) {
      stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + `\n...(truncated ${stderr.length - MAX_OUTPUT_LENGTH} chars)`
    }
    parts.push(`stderr:\n${stderr}`)
  }
  parts.push(`exit code: ${result.exitCode}`)
  return parts.join("\n\n")
}

function readSkill(input: ReadSkillInput): string {
  const content = getSkill(input.name)
  if (content) return content
  const available = getSkillIndex()
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n")
  return `Unknown skill: "${input.name}". Available skills:\n${available || "(none)"}`
}

async function listFiles(
  sandbox: SandboxInstance,
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
