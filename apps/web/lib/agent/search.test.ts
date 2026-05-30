import { describe, expect, it } from "vitest"

import { buildGlobInvocation, buildGrepInvocation, truncateOutput } from "@/lib/agent/search"

describe("buildGrepInvocation (ripgrep)", () => {
  it("builds an rg invocation that prints file:line and skips node_modules/.git", () => {
    const { cmd, args } = buildGrepInvocation({ pattern: "useState", useRipgrep: true })

    expect(cmd).toBe("rg")
    expect(args).toContain("-n")
    expect(args).toContain("useState")
    expect(args.join(" ")).toContain("node_modules")
    expect(args.join(" ")).toContain(".git")
  })

  it("threads case-insensitivity, an include glob, and a path through", () => {
    const { args } = buildGrepInvocation({
      pattern: "todo",
      path: "src",
      include: "*.ts",
      ignoreCase: true,
      useRipgrep: true,
    })

    expect(args).toContain("-i")
    expect(args).toContain("*.ts")
    expect(args).toContain("src")
  })
})

describe("buildGrepInvocation (grep fallback)", () => {
  it("falls back to grep -rn excluding node_modules/.git when ripgrep is absent", () => {
    const { cmd, args } = buildGrepInvocation({ pattern: "useState", useRipgrep: false })

    expect(cmd).toBe("grep")
    expect(args).toContain("-rn")
    expect(args).toContain("--exclude-dir=node_modules")
    expect(args).toContain("--exclude-dir=.git")
    expect(args).toContain("useState")
  })
})

describe("buildGlobInvocation", () => {
  it("builds a find invocation for a file-pattern, skipping node_modules/.git", () => {
    const { cmd, args } = buildGlobInvocation({ pattern: "**/*.tsx" })

    expect(cmd).toBe("find")
    expect(args).toContain("-type")
    expect(args).toContain("f")
    expect(args.join(" ")).toContain(".tsx")
    expect(args.join(" ")).toContain("node_modules")
    expect(args.join(" ")).toContain(".git")
  })
})

describe("truncateOutput", () => {
  it("returns short output unchanged", () => {
    expect(truncateOutput("hello", 100)).toBe("hello")
  })

  it("truncates over-long output and appends a notice", () => {
    const out = truncateOutput("abcdef", 3)

    expect(out).toContain("abc")
    expect(out).not.toContain("def")
    expect(out.toLowerCase()).toContain("truncated")
  })
})
