import { describe, expect, it } from "vitest"

import { parseProcStat, parsePs, runningCommand } from "./busy"

describe("parseProcStat", () => {
  it("reads pid, name and ppid, keeping spaces and parens in the name", () => {
    expect(
      parseProcStat(
        [
          "1 (init) S 0 1 1 0 -1",
          "42 (tmux: server) S 1 42 42 0 -1",
          "43 (weird) name)) R 42 43 43 34816 43",
          "",
        ].join("\n")
      )
    ).toEqual([
      { pid: 1, name: "init", ppid: 0 },
      { pid: 42, name: "tmux: server", ppid: 1 },
      { pid: 43, name: "weird) name)", ppid: 42 },
    ])
  })
})

describe("parsePs", () => {
  it("reads macOS ps output, reducing paths and login dashes to the name", () => {
    expect(
      parsePs("  501   1 /bin/zsh\n  502 501 -zsh\n  503 502 claude\n")
    ).toEqual([
      { pid: 501, ppid: 1, name: "zsh" },
      { pid: 502, ppid: 501, name: "zsh" },
      { pid: 503, ppid: 502, name: "claude" },
    ])
  })
})

describe("runningCommand", () => {
  const row = (pid: number, ppid: number, name: string) => ({
    pid,
    ppid,
    name,
  })

  it("is null for an idle shell", () => {
    expect(runningCommand([row(10, 1, "bash")], 10)).toBeNull()
  })

  it("names a harness running under the launch shell", () => {
    // sh -c 'claude; exec $SHELL' → claude → node workers
    const rows = [
      row(10, 1, "sh"),
      row(11, 10, "claude"),
      row(12, 11, "node"),
      row(99, 1, "claude"), // another tab's: not in this tree
    ]
    expect(runningCommand(rows, 10)).toBe("claude")
  })

  it("is null once the harness has exited into the user's shell", () => {
    expect(runningCommand([row(10, 1, "zsh")], 10)).toBeNull()
  })

  it("names a command started from a shell", () => {
    const rows = [row(10, 1, "zsh"), row(11, 10, "zsh"), row(12, 11, "node")]
    expect(runningCommand(rows, 10)).toBe("node")
  })

  it("names a root that isn't a shell", () => {
    expect(runningCommand([row(10, 1, "codex")], 10)).toBe("codex")
  })

  it("is null when the root is gone", () => {
    expect(runningCommand([row(11, 10, "node")], 10)).toBeNull()
  })
})
