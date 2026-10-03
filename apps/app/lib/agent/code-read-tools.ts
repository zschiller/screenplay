import "server-only"

import { tool } from "ai"
import { z } from "zod"

import { annotateTools } from "@/lib/mcp/tool-server"
import { renderFileWindow } from "@/lib/agent/render"
import {
  buildGlobInvocation,
  buildGrepInvocation,
  truncateOutput,
} from "@/lib/agent/search"
import { sandboxProvider, type SandboxInstance } from "@/lib/sandbox"
import type { RoomDoc } from "@/lib/room-access"
import { repoShortName } from "@/lib/repo-identity"
import type { BranchData, RepoData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"

/**
 * Reading a checkout's code: the file, search and find reads a Workspace's
 * agent runs on its own sandbox, and the same reads of the canvas's other
 * Workspaces. A Workspace has one chat, the only one that changes its code
 * (#1315); every other chat reads it here and never writes.
 */

/** The part of a Sandbox the code reads use. */
export type CodeReader = Pick<
  SandboxInstance,
  "readFileToBuffer" | "runCommand"
>

/** A file, line-numbered like `cat -n`, or a not-found line. */
export async function readCodeFile(
  sandbox: CodeReader,
  opts: { path: string; offset?: number; limit?: number }
): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path: opts.path })
  if (!buf) return `File not found: ${opts.path}`
  return renderFileWindow({
    content: buf.toString("utf-8"),
    offset: opts.offset,
    limit: opts.limit,
  })
}

/** Matching lines as `file:line: text`, with ripgrep or grep. */
export async function searchCode(
  sandbox: CodeReader,
  opts: {
    pattern: string
    path?: string
    include?: string
    ignoreCase?: boolean
  }
): Promise<string> {
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
}

/** File paths matching a glob. */
export async function findCodeFiles(
  sandbox: CodeReader,
  opts: { pattern: string; path?: string }
): Promise<string> {
  const { cmd, args } = buildGlobInvocation(opts)
  const result = await sandbox.runCommand(cmd, args)
  const stdout = await result.stdout()
  if (!stdout.trim()) return "(no files found)"
  return truncateOutput(stdout)
}

/** A Workspace whose checkout a chat can read. */
export interface CodeCheckout {
  workspaceId: string
  title: string
  /** The repository's short name. */
  repo: string
  sandboxName: string
}

/** The canvas's Workspaces that have a checkout, oldest first. */
export function codeCheckouts(collections: RoomCollections): CodeCheckout[] {
  const repos = new Map(
    records<RepoData>(collections, COLLECTION_KEYS.repos).map((r) => [
      r.id,
      repoShortName(r),
    ])
  )
  return records<BranchData>(collections, COLLECTION_KEYS.branches)
    .filter((b) => b.sandboxName)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((b) => ({
      workspaceId: b.id,
      title: workspaceLabel(b),
      repo: repos.get(b.repoId) ?? "repository",
      sandboxName: b.sandboxName,
    }))
}

export interface CodeReadPorts {
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
  /** A Workspace's Sandbox, woken if it was asleep. */
  openSandbox(sandboxName: string): Promise<CodeReader>
  /**
   * The reading chat's own Workspace, left out: it reads its own code with its
   * own tools.
   */
  ownSandboxName?: string
}

const workspaceIdField = z
  .string()
  .optional()
  .describe(
    "The Workspace whose code to read, from the list in your instructions. Optional when there is only one."
  )

/**
 * A chat's reads of other Workspaces' code. Every tool reads one Workspace's
 * checkout, named by `workspaceId` (optional when there is only one), and
 * never writes: only a Workspace's own chat changes its code (#1315).
 */
export function buildCodeReadTools(ports: CodeReadPorts) {
  async function withCheckout(
    workspaceId: string | undefined,
    read: (sandbox: CodeReader) => Promise<string>
  ): Promise<string> {
    const checkouts = (await ports.readDoc(codeCheckouts)).filter(
      (c) => c.sandboxName !== ports.ownSandboxName
    )
    const found = pickCheckout(checkouts, workspaceId)
    if (typeof found === "string") return found
    try {
      return await read(await ports.openSandbox(found.sandboxName))
    } catch (err) {
      return `Couldn’t read Workspace "${found.title}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const tools = {
    read_code_file: tool({
      description:
        "Read a file from another Workspace’s checkout of its repository, line-numbered like `cat -n`. Reads up to 2000 lines; pass `offset` (1-based) and `limit` to window a large file. Read-only.",
      inputSchema: z.object({
        workspaceId: workspaceIdField,
        path: z.string().describe("Path relative to the repo root"),
        offset: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: ({ workspaceId, ...opts }) =>
        withCheckout(workspaceId, (sandbox) => readCodeFile(sandbox, opts)),
    }),

    search_code: tool({
      description:
        "Search another Workspace’s code for a regular expression. Returns matching lines as `file:line: text`. Use `include` to restrict to a file glob (e.g. '*.tsx') and `path` to a directory. Skips node_modules and .git.",
      inputSchema: z.object({
        workspaceId: workspaceIdField,
        pattern: z.string().describe("The regular expression to search for"),
        path: z.string().optional().describe("Directory to search in"),
        include: z.string().optional().describe("File glob, e.g. '*.ts'"),
        case_insensitive: z.boolean().optional(),
      }),
      execute: ({ workspaceId, case_insensitive, ...opts }) =>
        withCheckout(workspaceId, (sandbox) =>
          searchCode(sandbox, { ...opts, ignoreCase: case_insensitive })
        ),
    }),

    find_code_files: tool({
      description:
        "Find files in another Workspace’s checkout by name pattern (e.g. '**/*.tsx'). Returns matching paths. Skips node_modules and .git.",
      inputSchema: z.object({
        workspaceId: workspaceIdField,
        pattern: z.string().describe("A file-matching glob, e.g. '**/*.tsx'"),
        path: z.string().optional().describe("Directory to search in"),
      }),
      execute: ({ workspaceId, ...opts }) =>
        withCheckout(workspaceId, (sandbox) => findCodeFiles(sandbox, opts)),
    }),
  }
  // The code reads only read, so a harness never asks before running one.
  return annotateTools(tools, {
    read_code_file: { readOnlyHint: true, openWorldHint: false },
    search_code: { readOnlyHint: true, openWorldHint: false },
    find_code_files: { readOnlyHint: true, openWorldHint: false },
  })
}

/**
 * A Workspace chat's reads of the canvas's other Workspaces (#1315), live:
 * over the turn's room doc, waking an asleep Sandbox when asked.
 */
export function otherWorkspacesCodeReadTools(opts: {
  room: Pick<RoomDoc, "readDoc">
  sandboxName: string
}) {
  return buildCodeReadTools({
    readDoc: (fn) => opts.room.readDoc(fn),
    openSandbox: (name) => sandboxProvider.get({ name, resume: true }),
    ownSandboxName: opts.sandboxName,
  })
}

function pickCheckout(
  checkouts: readonly CodeCheckout[],
  workspaceId: string | undefined
): CodeCheckout | string {
  if (checkouts.length === 0) {
    return "This canvas has no other Workspace with a checkout yet, so there is no code to read."
  }
  if (workspaceId) {
    return (
      checkouts.find((c) => c.workspaceId === workspaceId) ??
      `No Workspace with a checkout has id ${workspaceId}. ${listCheckouts(checkouts)}`
    )
  }
  if (checkouts.length === 1) return checkouts[0]!
  return `Pass a workspaceId. ${listCheckouts(checkouts)}`
}

function listCheckouts(checkouts: readonly CodeCheckout[]): string {
  return `Workspaces: ${checkouts.map((c) => `[${c.workspaceId}] "${c.title}" (${c.repo})`).join(", ")}.`
}

function records<T>(collections: RoomCollections, key: string): T[] {
  return Object.values(collections.doc.getMap(key).toJSON()) as T[]
}
