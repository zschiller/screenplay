import "server-only"

import { tool, jsonSchema } from "ai"
import {
  executeCustomTool,
  type ToolContext,
} from "@/lib/agent/tool-executor"
import type { CustomToolName } from "@/lib/agent/types"

/**
 * Adapter from our existing custom tools (config.ts:AGENT_TOOLS) to AI SDK
 * tool definitions. Each tool's `execute` defers to the same
 * `executeCustomTool` dispatcher the v1 routes use, so sandbox semantics
 * (read_file, run_command, edit_file, etc.) are unchanged.
 *
 * `submit_plan` intentionally has no `execute` — it's a human-in-the-loop
 * tool. When the model emits a submit_plan call, the loop halts via
 * `stopWhen: hasToolCall("submit_plan")` and the v2 stream route persists an
 * `agent_pending_tool_call` row. /api/agent/v2/plan resumes the loop later
 * with the user's approval/rejection as the tool result.
 */
export function buildAgentTools(ctx: ToolContext) {
  const wrap = (name: CustomToolName) => async (input: unknown) =>
    executeCustomTool(ctx, name, input as Record<string, unknown>)

  return {
    read_file: tool({
      description:
        "Read the contents of a file from the project. Returns the full file content as text. Use this to understand existing code before making changes.",
      inputSchema: jsonSchema<{ path: string }>({
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the file relative to the project root, e.g. 'src/App.tsx'",
          },
        },
        required: ["path"],
      }),
      execute: wrap("read_file"),
    }),

    write_file: tool({
      description:
        "Write content to a file, creating it if it doesn't exist or replacing it entirely. Use this for new files or complete rewrites.",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      }),
      execute: wrap("write_file"),
    }),

    edit_file: tool({
      description:
        "Perform a find-and-replace edit in a file. The old_string must match exactly (including whitespace and indentation). Use this for targeted changes to existing files.",
      inputSchema: jsonSchema<{
        path: string
        old_string: string
        new_string: string
      }>({
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      }),
      execute: wrap("edit_file"),
    }),

    run_command: tool({
      description:
        "Run a shell command in the project directory. Returns stdout, stderr, and exit code. Use for installing packages, running scripts, checking status, etc.",
      inputSchema: jsonSchema<{ command: string; args?: string[] }>({
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["command"],
      }),
      execute: wrap("run_command"),
    }),

    list_files: tool({
      description:
        "List files in the project directory. Returns file paths, useful for understanding project structure.",
      inputSchema: jsonSchema<{ path?: string; pattern?: string }>({
        type: "object",
        properties: {
          path: { type: "string" },
          pattern: { type: "string" },
        },
      }),
      execute: wrap("list_files"),
    }),

    create_pr: tool({
      description:
        "Open a GitHub pull request from this agent's branch into the workspace's default branch. Call this when the user asks to create, open, or submit a PR.",
      inputSchema: jsonSchema<{ title?: string; body?: string }>({
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
      }),
      execute: wrap("create_pr"),
    }),

    read_skill: tool({
      description:
        "Load the full instructions for a skill listed in your skills index. Returns markdown — read it carefully before making changes.",
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: wrap("read_skill"),
    }),

    // Human-in-the-loop: no execute. The loop halts on this tool call and
    // /api/agent/v2/plan supplies the result after the user decides.
    submit_plan: tool({
      description:
        "Submit a plan for user approval before making any file changes. The plan should be markdown describing what files will change and why. You MUST call this and wait for approval before write_file or edit_file when plan mode is enabled.",
      inputSchema: jsonSchema<{ plan: string }>({
        type: "object",
        properties: { plan: { type: "string" } },
        required: ["plan"],
      }),
    }),
  }
}

export type AgentTools = ReturnType<typeof buildAgentTools>
