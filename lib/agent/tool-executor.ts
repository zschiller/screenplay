import { Sandbox } from "@vercel/sandbox"
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
  const result = await sandbox.runCommand(input.command, input.args)
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
