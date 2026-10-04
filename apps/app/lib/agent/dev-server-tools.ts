import { tool } from "ai"
import { z } from "zod"

import { annotateTools } from "@/lib/mcp/tool-server"

/**
 * A Workspace agent's handle on its own dev server: the supervised `devScript`
 * process Screenplay runs in the Sandbox, whose output goes to the Logs panel
 * rather than any shell the agent has. Without these tools an agent can edit
 * the code behind a broken preview but can't see why it broke, and killing the
 * server from its shell just makes the supervisor respawn it.
 *
 * The tools only format; the {@link DevServerPorts} reach the Sandbox, so this
 * module stays testable without one (`dev-server-ports.ts` is the live side).
 */
export interface DevServerPorts {
  /** How the dev server is launched and whether it's answering right now. */
  status(): Promise<DevServerStatus>
  /** The raw tail of the dev server log (the Logs panel's content). */
  readLog(): Promise<string>
  /**
   * Dev Server Restart: bounce the dev server in place (the working tree is
   * untouched). Clears the log, as the Terminal Pane's Restart does. Also how a
   * stopped dev server runs again (#1342): the stop is cleared for everyone.
   */
  restart(): Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * Dev Server Stop (#1342): stop the dev server and its bridge proxy, as the
   * Terminal Pane's Stop does. The Sandbox keeps running and the log stays.
   */
  stop(): Promise<{ ok: true } | { ok: false; error: string }>
  /** Resolve true once the restarted server answers, false on timeout. */
  waitUntilAnswering(): Promise<boolean>
}

export interface DevServerStatus {
  /** The Repo's dev script. */
  command: string
  /** Where the server listens, reachable from the agent's own shell. */
  localUrl: string | null
  answering: boolean
  /** Why there's no server to reach (the Sandbox is stopped), if so. */
  unavailable?: string
  /** Someone stopped the dev server (#1342); `start_dev_server` runs it. */
  stopped?: boolean
}

const DEFAULT_LINES = 200
const MAX_LINES = 1000
/** How many trailing log lines follow a restart's outcome. */
const RESTART_TAIL_LINES = 40
/** Keep the tail, not the head: the newest output is what explains a failure. */
const MAX_LOG_CHARS = 20_000

export function buildDevServerTools(ports: DevServerPorts) {
  const tools = {
    read_dev_server_logs: tool({
      description:
        "Read the output of this Workspace’s dev server (the one behind the live preview): compile errors, runtime errors, request logs. Screenplay runs the dev server in the background, so its output never shows up in your own shell. Also reports whether the server is answering and the local URL it listens on, which you can curl. Use this first whenever the preview is blank, erroring or stale.",
      inputSchema: z.object({
        lines: z
          .number()
          .int()
          .positive()
          .max(MAX_LINES)
          .optional()
          .describe(
            `How many of the most recent lines to return (default ${DEFAULT_LINES}, max ${MAX_LINES})`
          ),
        filter: z
          .string()
          .optional()
          .describe(
            "Only return lines matching this case-insensitive regular expression, e.g. 'error|warn'"
          ),
      }),
      execute: async ({ lines = DEFAULT_LINES, filter }) => {
        let pattern: RegExp | null = null
        if (filter) {
          try {
            pattern = new RegExp(filter, "i")
          } catch {
            return `Invalid filter regular expression: ${filter}`
          }
        }
        const [status, log] = await Promise.all([
          ports.status(),
          ports.readLog(),
        ])
        let logLines = logToLines(log)
        if (pattern) logLines = logLines.filter((l) => pattern.test(l))
        const body = logLines.length
          ? tailChars(logLines.slice(-lines).join("\n"))
          : pattern
            ? "(no lines match the filter)"
            : "(the log is empty)"
        return `${describeStatus(status)}\n\n${body}`
      },
    }),

    restart_dev_server: tool({
      description:
        "Restart this Workspace’s dev server (the one behind the live preview), the same as the user’s \"Restart dev server\" action. Files and uncommitted changes are untouched. Use it when the server is wedged or crashed, or after a change it doesn’t hot-reload (config files, env vars, new dependencies). Never start a second dev server yourself with a shell command: it would fight this one for the port. Waits for the server to answer, then returns the start of the new log.",
      inputSchema: z.object({}),
      execute: () => launch(ports, "restarted", "restart"),
    }),

    stop_dev_server: tool({
      description:
        "Stop this Workspace’s dev server, the same as the user’s Stop in the terminal pane. The sandbox keeps running and files are untouched; the live preview goes dark until it’s started again with start_dev_server. Use it when the user asks, or when something needs the dev server off (it holds a port or a lock you need). Killing it from a shell doesn’t work: Screenplay respawns it.",
      inputSchema: z.object({}),
      execute: async () => {
        const stopped = await ports.stop()
        return stopped.ok
          ? "Dev server stopped. The preview is dark until start_dev_server runs it again."
          : `Couldn’t stop the dev server: ${stopped.error}`
      },
    }),

    start_dev_server: tool({
      description:
        "Start this Workspace’s dev server after it was stopped, the same as the user’s Run in the terminal pane. Never start one yourself with a shell command: it would fight this one for the port. Waits for the server to answer, then returns the start of the new log.",
      inputSchema: z.object({}),
      execute: () => launch(ports, "started", "start"),
    }),
  }
  // For a harness reaching these tools over MCP, so none of them prompts.
  return annotateTools(tools, {
    read_dev_server_logs: { readOnlyHint: true, openWorldHint: false },
    // Bounces a process the supervisor would restart anyway; no data is lost.
    restart_dev_server: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // Stops and starts the same process; no data is lost either way.
    stop_dev_server: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    start_dev_server: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
}

/** Restart and Start: the same launch, told apart only in their words. */
async function launch(
  ports: DevServerPorts,
  done: string,
  verb: string
): Promise<string> {
  const launched = await ports.restart()
  if (!launched.ok) {
    return `Couldn’t ${verb} the dev server: ${launched.error}`
  }
  const answering = await ports.waitUntilAnswering()
  const log = logToLines(await ports.readLog())
  const tail = log.length
    ? tailChars(log.slice(-RESTART_TAIL_LINES).join("\n"))
    : "(the log is empty)"
  const outcome = answering
    ? `Dev server ${done} and answering.`
    : `Dev server ${done} but isn’t answering yet. It may still be starting, or it crashed: check read_dev_server_logs.`
  return `${outcome}\n\nLatest log lines:\n${tail}`
}

export type DevServerTools = ReturnType<typeof buildDevServerTools>

function describeStatus(status: DevServerStatus): string {
  if (status.stopped) {
    return "Dev server: stopped (call start_dev_server to run it again)."
  }
  if (status.unavailable) {
    return `Dev server: not running (${status.unavailable}).`
  }
  const where = status.localUrl ? ` on ${status.localUrl}` : ""
  const state = status.answering ? "answering" : "not answering"
  return `Dev server: \`${status.command}\`${where}, ${state}.`
}

// CSI sequences (colors, cursor moves) and OSC sequences (titles, links).
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/**
 * The log as the model should read it: colors stripped (the dev server runs
 * with FORCE_COLOR for the Logs panel), and a carriage-return progress line
 * collapsed to what it last showed.
 */
export function logToLines(log: string): string[] {
  const lines = log
    .replace(ANSI, "")
    .split("\n")
    .map((line) => {
      const cr = line.replace(/\r+$/, "").lastIndexOf("\r")
      return (cr === -1 ? line : line.slice(cr + 1)).replace(/\r+$/, "")
    })
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop()
  return lines
}

function tailChars(text: string): string {
  if (text.length <= MAX_LOG_CHARS) return text
  const cut = text.length - MAX_LOG_CHARS
  return `...(${cut} earlier chars omitted)\n${text.slice(cut)}`
}
