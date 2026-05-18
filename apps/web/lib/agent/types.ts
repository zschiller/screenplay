export type CustomToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "run_command"
  | "list_files"
  | "submit_plan"
  | "create_pr"
  | "read_skill"
  | "read_document"
  | "replace_document_body"
  | "append_to_document_body"
  | "set_document_title"

export type ReadFileInput = { path: string }
export type WriteFileInput = { path: string; content: string }
export type EditFileInput = {
  path: string
  old_string: string
  new_string: string
}
export type RunCommandInput = { command: string; args?: string[] }
export type ListFilesInput = { path?: string; pattern?: string }
export type CreatePrInput = { title?: string; body?: string }
export type ReadSkillInput = { name: string }

export type CustomToolInput =
  | ReadFileInput
  | WriteFileInput
  | EditFileInput
  | RunCommandInput
  | ListFilesInput
  | CreatePrInput
  | ReadSkillInput

export type SubmitPlanInput = { plan: string }

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
  | {
      role: "plan"
      content: string
      status: "pending" | "approved" | "rejected"
      planId: string
    }

export type AgentStreamEvent =
  // `textId` identifies the source text block from the model. The client
  // tracks the most recent textId per chat and appends a new assistant
  // message whenever it changes, so multiple text blocks within a step
  // don't clobber each other in the UI.
  | { type: "user_message"; text: string }
  | { type: "text"; text: string; textId?: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string }
  | { type: "status"; status: string }
  | { type: "error"; message: string }
  | { type: "branch_rename"; branch: string }
  | { type: "chat_rename"; label: string }
  | { type: "plan_submitted"; planId: string; plan: string; toolEventId: string }
  | { type: "plan_approved"; planId: string }
  | { type: "plan_rejected"; planId: string; feedback: string }
  | { type: "done" }
