import { Sandbox } from "@vercel/sandbox"

/** Max characters to keep from command stdout/stderr to avoid bloating session history */
const MAX_OUTPUT_LENGTH = 20_000

import type {
  CustomToolName,
  ReadFileInput,
  WriteFileInput,
  EditFileInput,
  RunCommandInput,
  ListFilesInput,
} from "./types"

export async function executeCustomTool(
  sandboxName: string,
  toolName: CustomToolName,
  toolInput: Record<string, unknown>,
): Promise<string> {
  const sandbox = await Sandbox.get({ name: sandboxName })

  let result: string
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
      result = await runCommand(sandbox, toolInput as unknown as RunCommandInput)
      break
    case "list_files":
      result = await listFiles(sandbox, toolInput as unknown as ListFilesInput)
      break
    default:
      result = `Unknown tool: ${toolName}`
  }
  // Anthropic API requires tool result text to be at least 1 character
  return result || "(empty)"
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
  sandbox: Sandbox,
  input: RunCommandInput,
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

  const result = await sandbox.runCommand(cmd, args)
  const parts: string[] = []
  let stdout = await result.stdout()
  let stderr = await result.stderr()
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
