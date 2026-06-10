import "server-only"

import { tool } from "ai"
import { z } from "zod"

import { sandboxProvider, usesHostGitAuth } from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"
import { createGitHubPr } from "@/lib/github-pr"
import { getGitHubTokenForUser, getGitIdentityForUser } from "@/lib/auth-helpers"
import { getSkill, getSkillIndex } from "@/lib/skills"
import {
  enumerateRepoSkills,
  readRepoSkillBody,
  sandboxRepoSkillFs,
  type RepoSkillFs,
} from "@/lib/skills/repo-skills"
import {
  formatMergedListing,
  mergeSkillIndexes,
  resolveSkillBody,
} from "@/lib/skills/merged"
import { applyTextEdit } from "@/lib/agent/edit"
import { renderFileWindow } from "@/lib/agent/render"
import {
  buildGlobInvocation,
  buildGrepInvocation,
  truncateOutput,
} from "@/lib/agent/search"

/**
 * Everything a sandbox tool needs to act on behalf of the acting collaborator:
 * which VM to talk to, which room it belongs to, and whose GitHub token to
 * attribute git operations to. Passed once to `buildSandboxTools` and closed
 * over by every tool's `execute`.
 */
export interface ToolContext {
  sandboxName: string
  roomId: string
  userId: string
}

/**
 * The sandbox-backed toolset for an agent chat target. Each tool follows the
 * AI SDK grain: `tool({ description, inputSchema, execute })` with a zod schema
 * that hands `execute` typed, validated input — no `as unknown as` casts, and
 * bad arguments are rejected before `execute` runs.
 *
 * Output redaction is **not** done here: the assembly point (`toolsetFor`)
 * wraps every tool with `withRedactedOutput`, so secrets are scrubbed uniformly
 * regardless of which tool produced them. Per-tool `execute` only does its own
 * formatting (e.g. `run_command`'s framing + truncation).
 *
 * `submit_plan` intentionally has no `execute` — it's a human-in-the-loop tool.
 * When the model emits a `submit_plan` call, the loop halts via
 * `stopWhen: hasToolCall("submit_plan")` and the stream route persists an
 * `agent_pending_tool_call` row. `/api/agent/plan` resumes the loop later with
 * the user's approval/rejection as the tool result.
 */
export function buildSandboxTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description:
        "Read the contents of a file from the project. Output is line-numbered in `cat -n` style (a right-aligned line number, a tab, then the line). Reads up to 2000 lines by default; pass `offset` (1-based line to start at) and `limit` to window a large file. Use this to understand existing code before making changes. NOTE: the line-number + tab prefix is display only — strip it before reusing a line as `edit_file`'s `old_string`.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Path to the file relative to the project root, e.g. 'src/App.tsx'"
          ),
        offset: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based line number to start reading from"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of lines to read"),
      }),
      execute: async ({ path, offset, limit }) => {
        const sandbox = await getSandbox(ctx)
        const buf = await sandbox.readFileToBuffer({ path })
        if (!buf) return `File not found: ${path}`
        return renderFileWindow({
          content: buf.toString("utf-8"),
          offset,
          limit,
        })
      },
    }),

    write_file: tool({
      description:
        "Write content to a file, creating it if it doesn't exist or replacing it entirely. Use this for new files or complete rewrites.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        const sandbox = await getSandbox(ctx)
        await sandbox.writeFiles([{ path, content }])
        return `Written ${content.length} bytes to ${path}`
      },
    }),

    edit_file: tool({
      description:
        "Perform a find-and-replace edit in a file. The old_string must match exactly (including whitespace and indentation) and must be UNIQUE — if it matches more than once the edit is rejected with the match count, so add surrounding context to disambiguate, or pass replace_all to change every occurrence. If you copied the old_string from read_file, first strip the leading line-number + tab prefix. Use this for targeted changes to existing files.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z
          .boolean()
          .optional()
          .describe(
            "Replace every occurrence instead of requiring a unique match"
          ),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const sandbox = await getSandbox(ctx)
        const buf = await sandbox.readFileToBuffer({ path })
        if (!buf) return `File not found: ${path}`

        const result = applyTextEdit({
          content: buf.toString("utf-8"),
          oldString: old_string,
          newString: new_string,
          replaceAll: replace_all,
        })

        if (!result.ok) {
          if (result.reason === "not_found") {
            return `old_string not found in ${path}. Make sure it matches exactly including whitespace, and strip any line-number prefix from read_file.`
          }
          return `old_string is ambiguous in ${path}: found ${result.count} matches. Add surrounding context to make it unique, or pass replace_all to change every occurrence.`
        }

        await sandbox.writeFiles([{ path, content: result.content }])
        const occurrences =
          result.replacements === 1
            ? "1 occurrence"
            : `${result.replacements} occurrences`
        return `Edited ${path}: replaced ${occurrences}.`
      },
    }),

    run_command: tool({
      description:
        "Run a shell command in the project directory. Returns stdout, stderr, and exit code. Use for installing packages, running scripts, checking status, etc.",
      inputSchema: z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
      }),
      execute: async ({ command, args }) => runCommand(ctx, command, args),
    }),

    list_files: tool({
      description:
        "List files in the project directory. Returns file paths, useful for understanding project structure.",
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional(),
      }),
      execute: async ({ path, pattern }) => {
        const sandbox = await getSandbox(ctx)
        const args = [path || ".", "-maxdepth", "3", "-type", "f"]
        if (pattern) args.push("-name", pattern)
        // Exclude node_modules and .git
        args.push("!", "-path", "*/node_modules/*", "!", "-path", "*/.git/*")
        const result = await sandbox.runCommand("find", args)
        const stdout = await result.stdout()
        return stdout || "(no files found)"
      },
    }),

    grep: tool({
      description:
        "Search file contents across the project. Returns matching lines as `file:line: text`. Prefers ripgrep and falls back to grep automatically. Use `include` to restrict to a file-glob (e.g. '*.ts'), `path` to restrict to a directory, and `case_insensitive` for a case-insensitive search. Skips node_modules and .git.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe("The regular expression / text to search for"),
        path: z
          .string()
          .optional()
          .describe("Directory to search in (defaults to the project root)"),
        include: z
          .string()
          .optional()
          .describe("Restrict to files matching this glob, e.g. '*.tsx'"),
        case_insensitive: z.boolean().optional(),
      }),
      execute: async ({ pattern, path, include, case_insensitive }) => {
        const sandbox = await getSandbox(ctx)
        const opts = { pattern, path, include, ignoreCase: case_insensitive }

        const rg = buildGrepInvocation({ ...opts, useRipgrep: true })
        let result = await sandbox.runCommand(rg.cmd, rg.args)
        // Exit 127 = ripgrep isn't installed in this image; retry with grep.
        if (result.exitCode === 127) {
          const fallback = buildGrepInvocation({ ...opts, useRipgrep: false })
          result = await sandbox.runCommand(fallback.cmd, fallback.args)
        }

        const stdout = await result.stdout()
        if (!stdout.trim()) return "(no matches found)"
        return truncateOutput(stdout)
      },
    }),

    glob: tool({
      description:
        "Find files by name pattern (e.g. '**/*.tsx'). Returns matching file paths. Skips node_modules and .git. Prefer this over list_files for enumerating files of a kind.",
      inputSchema: z.object({
        pattern: z.string().describe("A file-matching glob, e.g. '**/*.tsx'"),
        path: z
          .string()
          .optional()
          .describe("Directory to search in (defaults to the project root)"),
      }),
      execute: async ({ pattern, path }) => {
        const sandbox = await getSandbox(ctx)
        const { cmd, args } = buildGlobInvocation({ pattern, path })
        const result = await sandbox.runCommand(cmd, args)
        const stdout = await result.stdout()
        if (!stdout.trim()) return "(no files found)"
        return truncateOutput(stdout)
      },
    }),

    create_pr: tool({
      description:
        "Open a GitHub pull request from this agent's branch into the workspace's default branch. Call this when the user asks to create, open, or submit a PR.",
      inputSchema: z.object({
        title: z.string().optional(),
        body: z.string().optional(),
      }),
      execute: async ({ title, body }) => {
        try {
          const { url, number } = await createGitHubPr({
            userId: ctx.userId,
            roomId: ctx.roomId,
            sandboxName: ctx.sandboxName,
            title,
            body,
          })
          return `Created PR #${number}: ${url}`
        } catch (e) {
          return `Failed to create PR: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    read_skill: tool({
      description:
        "Load the full instructions for a skill listed in your skills index. Returns markdown — read it carefully before making changes.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        // Resolve sandbox-first (a Repo Skill in `.claude/skills/` overrides a
        // bundled App Skill of the same name), then fall back to the App Skill.
        const fs = await getRepoSkillFs(ctx)
        const content = await resolveSkillBody(name, {
          readRepoBody: (n) =>
            fs ? readRepoSkillBody(fs, n) : Promise.resolve(null),
          readAppBody: (n) => getSkill(n),
        })
        if (content) return content
        // Unknown name → list the merged set (App ∪ Repo) so the model can
        // pick a real one.
        const repo = fs ? await enumerateRepoSkills(fs).catch(() => []) : []
        const merged = mergeSkillIndexes(getSkillIndex(), repo)
        return `Unknown skill: "${name}". Available skills:\n${formatMergedListing(merged)}`
      },
    }),

    // Human-in-the-loop: no execute. The loop halts on this tool call and
    // /api/agent/plan supplies the result after the user decides.
    submit_plan: tool({
      description:
        "Submit a plan for user approval before making any file changes. The plan should be markdown describing what files will change and why. You MUST call this and wait for approval before write_file or edit_file when plan mode is enabled.",
      inputSchema: z.object({ plan: z.string() }),
    }),
  }
}

export type SandboxTools = ReturnType<typeof buildSandboxTools>

async function getSandbox(ctx: ToolContext): Promise<SandboxInstance> {
  return sandboxProvider.get({ name: ctx.sandboxName })
}

/**
 * A Repo-Skill filesystem port backed by this chat's sandbox, or `null` when
 * the sandbox is unreachable. Lets `read_skill` degrade to App-Skill-only
 * resolution instead of failing the whole tool call when the VM is down.
 */
async function getRepoSkillFs(ctx: ToolContext): Promise<RepoSkillFs | null> {
  try {
    return sandboxRepoSkillFs(await getSandbox(ctx))
  } catch {
    return null
  }
}

/**
 * Broker the acting user's git identity onto the next runCommand. Two things
 * ride along, both keyed to whichever collaborator triggered this turn — not to
 * whoever first provisioned the (shared) sandbox:
 *
 *   - SCREENPLAY_GH_TOKEN — their GitHub token; the in-sandbox credential helper
 *     feeds it to git, so the *push* authenticates as them.
 *   - `GIT_AUTHOR_*` / `GIT_COMMITTER_*` — their real name + email; git honors
 *     these over `user.*` config, so the *commit author* is them too. This is what
 *     keeps commit authorship consistent with push attribution on a shared
 *     sandbox, instead of a single static (or fabricated) identity.
 *
 * On the local backend this is a no-op: git runs as a host process and
 * authenticates / authors through the user's own credentials and git config, so
 * there is nothing to broker per command.
 */
async function buildAgentGitEnv(
  ctx: ToolContext
): Promise<Record<string, string> | undefined> {
  if (usesHostGitAuth) return undefined
  try {
    const [token, identity] = await Promise.all([
      getGitHubTokenForUser(ctx.userId),
      getGitIdentityForUser(ctx.userId),
    ])
    const env: Record<string, string> = {}
    if (token) env.SCREENPLAY_GH_TOKEN = token
    if (identity) {
      env.GIT_AUTHOR_NAME = identity.name
      env.GIT_AUTHOR_EMAIL = identity.email
      env.GIT_COMMITTER_NAME = identity.name
      env.GIT_COMMITTER_EMAIL = identity.email
    }
    return Object.keys(env).length > 0 ? env : undefined
  } catch {
    return undefined
  }
}

/** Characters that indicate the command needs a shell to interpret it */
const SHELL_OPERATORS = /[&&|;><$`(){}]/

async function runCommand(
  ctx: ToolContext,
  command: string,
  inputArgs: string[] | undefined
): Promise<string> {
  let cmd: string
  let args: string[]

  if (inputArgs && inputArgs.length > 0) {
    // Explicit args array — use as-is
    cmd = command
    args = inputArgs
  } else if (SHELL_OPERATORS.test(command)) {
    // Command contains shell operators (&&, |, etc.) — run through sh -c
    cmd = "sh"
    args = ["-c", command]
  } else {
    // Simple command string — parse respecting quotes
    const tokens = parseCommandString(command)
    cmd = tokens[0]
    args = tokens.slice(1)
  }

  const sandbox = await getSandbox(ctx)
  const gitEnv = await buildAgentGitEnv(ctx)
  const result = await sandbox.runCommand({
    cmd,
    args,
    ...(gitEnv ? { env: gitEnv } : {}),
  })
  // Redaction is applied uniformly at the assembly point (withRedactedOutput),
  // so this only frames and truncates; it never scrubs secrets itself.
  const parts: string[] = []
  const stdout = await result.stdout()
  const stderr = await result.stderr()
  if (stdout) parts.push(`stdout:\n${truncateOutput(stdout)}`)
  if (stderr) parts.push(`stderr:\n${truncateOutput(stderr)}`)
  parts.push(`exit code: ${result.exitCode}`)
  return parts.join("\n\n")
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
