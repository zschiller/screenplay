import { describe, expect, it, vi } from "vitest"

import {
  buildDevServerTools,
  logToLines,
  type DevServerPorts,
  type DevServerStatus,
} from "@/lib/agent/dev-server-tools"

const running: DevServerStatus = {
  command: "pnpm dev",
  localUrl: "http://localhost:4123",
  answering: true,
}

function ports(overrides: Partial<DevServerPorts> = {}): DevServerPorts {
  return {
    status: vi.fn(async () => running),
    readLog: vi.fn(async () => ""),
    restart: vi.fn(async () => ({ ok: true as const })),
    stop: vi.fn(async () => ({ ok: true as const })),
    waitUntilAnswering: vi.fn(async () => true),
    ...overrides,
  }
}

// The tools' `execute` is typed for the AI SDK's call options; tests call it
// with just the input.
async function run(
  tools: ReturnType<typeof buildDevServerTools>,
  name: keyof ReturnType<typeof buildDevServerTools>,
  input: Record<string, unknown> = {}
): Promise<string> {
  const execute = tools[name].execute as (
    input: unknown,
    options: unknown
  ) => Promise<string>
  return execute(input, {})
}

describe("read_dev_server_logs", () => {
  it("leads with how the server runs and whether it answers", async () => {
    const tools = buildDevServerTools(
      ports({ readLog: async () => "ready in 1.2s\n" })
    )
    expect(await run(tools, "read_dev_server_logs")).toBe(
      "Dev server: `pnpm dev` on http://localhost:4123, answering.\n\nready in 1.2s"
    )
  })

  it("returns only the most recent lines asked for", async () => {
    const log = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
    const tools = buildDevServerTools(ports({ readLog: async () => log }))
    const out = await run(tools, "read_dev_server_logs", { lines: 3 })
    expect(out.split("\n\n")[1]).toBe("line 8\nline 9\nline 10")
  })

  it("filters lines by a case-insensitive pattern before taking the tail", async () => {
    const log = "ok\nError: one\nok\nwarn: two\nok"
    const tools = buildDevServerTools(ports({ readLog: async () => log }))
    const out = await run(tools, "read_dev_server_logs", {
      filter: "error|WARN",
    })
    expect(out.split("\n\n")[1]).toBe("Error: one\nwarn: two")
  })

  it("rejects a filter that isn't a regular expression", async () => {
    const tools = buildDevServerTools(ports())
    expect(await run(tools, "read_dev_server_logs", { filter: "(" })).toBe(
      "Invalid filter regular expression: ("
    )
  })

  it("says when the sandbox is stopped", async () => {
    const tools = buildDevServerTools(
      ports({
        status: async () => ({
          command: "pnpm dev",
          localUrl: null,
          answering: false,
          unavailable: "the sandbox is stopped",
        }),
      })
    )
    expect(await run(tools, "read_dev_server_logs")).toBe(
      "Dev server: not running (the sandbox is stopped).\n\n(the log is empty)"
    )
  })
})

describe("restart_dev_server", () => {
  it("restarts, waits for the server, and shows the new log", async () => {
    const p = ports({ readLog: async () => "$ pnpm dev\nready\n" })
    const out = await run(buildDevServerTools(p), "restart_dev_server")
    expect(p.restart).toHaveBeenCalledOnce()
    expect(p.waitUntilAnswering).toHaveBeenCalledOnce()
    expect(out).toBe(
      "Dev server restarted and answering.\n\nLatest log lines:\n$ pnpm dev\nready"
    )
  })

  it("points at the logs when the server doesn't come back", async () => {
    const tools = buildDevServerTools(
      ports({
        waitUntilAnswering: async () => false,
        readLog: async () => "Error: Cannot find module 'next'",
      })
    )
    const out = await run(tools, "restart_dev_server")
    expect(out).toMatch(/isn't answering yet/)
    expect(out).toMatch(/Cannot find module 'next'/)
  })

  it("reports a failed restart without waiting", async () => {
    const p = ports({
      restart: async () => ({ ok: false, error: "Sandbox is not running" }),
    })
    expect(await run(buildDevServerTools(p), "restart_dev_server")).toBe(
      "Couldn't restart the dev server: Sandbox is not running"
    )
    expect(p.waitUntilAnswering).not.toHaveBeenCalled()
  })
})

describe("stop_dev_server and start_dev_server (#1342)", () => {
  it("stops the dev server", async () => {
    const p = ports()
    expect(await run(buildDevServerTools(p), "stop_dev_server")).toBe(
      "Dev server stopped. The preview is dark until start_dev_server runs it again."
    )
    expect(p.stop).toHaveBeenCalledOnce()
  })

  it("reports a failed stop", async () => {
    const p = ports({ stop: async () => ({ ok: false, error: "gone" }) })
    expect(await run(buildDevServerTools(p), "stop_dev_server")).toBe(
      "Couldn't stop the dev server: gone"
    )
  })

  it("starts it through the restart path and waits for it", async () => {
    const p = ports({ readLog: async () => "$ pnpm dev\nready\n" })
    expect(await run(buildDevServerTools(p), "start_dev_server")).toBe(
      "Dev server started and answering.\n\nLatest log lines:\n$ pnpm dev\nready"
    )
    expect(p.restart).toHaveBeenCalledOnce()
  })

  it("tells the model a stopped server is stopped, not broken", async () => {
    const p = ports({
      status: async () => ({ ...running, answering: false, stopped: true }),
    })
    expect(await run(buildDevServerTools(p), "read_dev_server_logs")).toBe(
      "Dev server: stopped (call start_dev_server to run it again).\n\n(the log is empty)"
    )
  })
})

describe("logToLines", () => {
  it("strips colors and keeps the last frame of a progress line", () => {
    expect(
      logToLines("\x1b[32m✓\x1b[39m Ready\nProgress 10%\rProgress 100%\r\n\n")
    ).toEqual(["✓ Ready", "Progress 100%"])
  })
})
