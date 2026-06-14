import { spawn as nodeSpawn } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { resolveAcpLaunch, type AcpLaunch } from "../harnesses/acp-launch"
import type { AcpSessionFactory } from "./acp-engine"
import { ndJsonStream, type Stream } from "./schema"
import {
  AcpSession,
  type AcpSessionPorts,
  type OpenSessionOptions,
} from "./session"

/**
 * The production {@link AcpSessionFactory} (PRD #404, issue #414; ADR 0006's
 * "sole remaining deferral"): it spawns the user's installed CLI's **ACP
 * adapter** as a host subprocess and wraps its stdio as the {@link AcpSession}'s
 * transport. This is the real second backing of the same seam the in-memory
 * test factory fills — the engine drives the identical {@link AcpSession}, so a
 * spawned subprocess and a crossed pair of in-memory streams are provably
 * interchangeable (the shared Engine contract test runs over both).
 *
 * The adapter rides the CLI's own auth — no model key, no egress firewall — and
 * runs with `cwd` = the Branch's worktree. The spawn argv, working directory,
 * and child env come from the harness → ACP launch resolver
 * ({@link resolveAcpLaunch}, spikes #405/#408), so the load-bearing env quirk
 * (strip `CLAUDECODE`/`CLAUDE_CODE_*` or the Claude adapter refuses to launch)
 * lives in one place.
 *
 * Lifecycle/hardening note: each {@link open} spawns one child and tracks it so
 * {@link dispose} can reap them (used by tests, and by app shutdown once the
 * desktop shell wires it). Deeper supervision — restart, reconnection backoff —
 * is deferred above this seam (ADR 0006) and intentionally absent here.
 */
export interface SpawnAcpSessionFactoryConfig {
  /** Harness key whose ACP adapter to spawn (e.g. `claude`, `codex`). */
  harnessKey: string
  /**
   * The chat's chosen model within the Harness, for an adapter that takes its
   * model at spawn ({@link import("../harnesses/types").AcpAdapter.modelArgs} —
   * codex's `--model`, spike #523). Folded into the launch argv by
   * {@link resolveAcpLaunch}; ignored by ACP-native adapters (claude-code),
   * which apply the model in-session. Absent ⇒ the Harness default, argv
   * unchanged.
   */
  modelId?: string
  /** Base environment for the child; defaults to the host `process.env`. */
  env?: Record<string, string | undefined>
  /**
   * Process spawner, injected so tests can launch a fake ACP-agent script in
   * place of the real adapter. Defaults to `node:child_process.spawn`.
   */
  spawn?: AcpSpawn
}

/** A spawned child as this factory uses it — the slice of `ChildProcess` it needs. */
export interface SpawnedAcpChild {
  stdin: Writable | null
  stdout: Readable | null
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: "error", listener: (err: Error) => void): unknown
  on(event: "exit", listener: (code: number | null) => void): unknown
}

/** The process spawner seam: argv + spawn options → a child with piped stdio. */
export type AcpSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> }
) => SpawnedAcpChild

export class SpawnAcpSessionFactory implements AcpSessionFactory {
  private readonly children = new Set<SpawnedAcpChild>()

  constructor(private readonly config: SpawnAcpSessionFactoryConfig) {}

  async open(
    ports: AcpSessionPorts,
    options: OpenSessionOptions
  ): Promise<AcpSession> {
    const launch = resolveAcpLaunch(this.config.harnessKey, {
      cwd: options.cwd,
      env: this.config.env ?? process.env,
      modelId: this.config.modelId,
    })
    if (!launch) {
      throw new Error(
        `No ACP adapter is registered for harness "${this.config.harnessKey}" — cannot spawn an external agent`
      )
    }

    const child = this.spawnChild(launch)
    this.children.add(child)
    // A `child.error` (e.g. the adapter binary is missing) would otherwise
    // surface as an unhandled error event and crash the process; swallow it
    // here — the failed handshake/stream below rejects `open` with the real
    // cause, which the engine reports as a turn error.
    child.on("error", () => {})
    child.on("exit", () => this.children.delete(child))

    try {
      const transport = childTransport(child)
      return await AcpSession.open(transport, ports, options)
    } catch (e) {
      child.kill()
      this.children.delete(child)
      throw e
    }
  }

  /** Terminate every child this factory has spawned. */
  dispose(): void {
    for (const child of this.children) child.kill()
    this.children.clear()
  }

  private spawnChild(launch: AcpLaunch): SpawnedAcpChild {
    const spawn =
      this.config.spawn ??
      ((command, args, opts) =>
        nodeSpawn(command, args, {
          cwd: opts.cwd,
          // Next.js augments `ProcessEnv` to require `NODE_ENV`; the resolver
          // hands us a plain string map, which is a valid child env.
          env: opts.env as NodeJS.ProcessEnv,
          // stdin/stdout are the ACP wire; stderr is inherited so adapter
          // diagnostics reach the host logs without corrupting the ndjson.
          stdio: ["pipe", "pipe", "inherit"],
        }))
    return spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
    })
  }
}

/**
 * Wrap a spawned child's stdio as a genuine ACP {@link Stream}: write the
 * client's JSON-RPC to the child's stdin and read the agent's from its stdout,
 * newline-delimited (`ndJsonStream`). The same `Stream` shape the in-memory test
 * transport produces — only the backing differs.
 */
function childTransport(child: SpawnedAcpChild): Stream {
  if (!child.stdin || !child.stdout) {
    throw new Error("spawned ACP agent is missing a stdio pipe")
  }
  return ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  )
}
