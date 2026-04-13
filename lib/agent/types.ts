export type CustomToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "run_command"
  | "list_files"

export type ReadFileInput = { path: string }
export type WriteFileInput = { path: string; content: string }
export type EditFileInput = {
  path: string
  old_string: string
  new_string: string
}
export type RunCommandInput = { command: string; args?: string[] }
export type ListFilesInput = { path?: string; pattern?: string }

export type CustomToolInput =
  | ReadFileInput
  | WriteFileInput
  | EditFileInput
  | RunCommandInput
  | ListFilesInput

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      role: "tool_use"
      name: CustomToolName
      input: Record<string, unknown>
    }
  | {
      role: "tool_result"
      name: CustomToolName
      output: string
    }
  | { role: "error"; content: string }

export type AgentStreamEvent =
  | { type: "session_id"; sessionId: string }
  | { type: "user_message"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string }
  | { type: "status"; status: string }
  | { type: "error"; message: string }
  | { type: "branch_rename"; branch: string }
  | { type: "chat_rename"; label: string }
  | { type: "done" }
