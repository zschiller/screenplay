import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoDir = fileURLToPath(new URL("../../../", import.meta.url))

/** The app and the shared UI package: everything the app renders. */
function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "apps/app", "packages/ui/src"], {
    cwd: repoDir,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
}

/**
 * Stock shadcn values we keep as shipped, so the copies stay easy to diff
 * against upstream.
 */
const ALLOWED = new Set(["packages/ui/src/components/button.tsx text-[0.8rem]"])

const ARBITRARY_TEXT_SIZE = /(?<![\w-])text-\[\d*\.?\d+(?:px|rem|em|pt)\]/g
// Same-value width and height on one element, e.g. `h-3 w-3`.
const SPLIT_SIZE =
  /(?<![\w:[-])(?:h-([\d.]+|\[[^\]]+\]) w-\1|w-([\d.]+|\[[^\]]+\]) h-\2)(?![\w.\]-])/g

function violations(pattern: RegExp): string[] {
  const problems: string[] = []
  for (const file of sourceFiles()) {
    const lines = readFileSync(repoDir + file, "utf8").split("\n")
    lines.forEach((line, i) => {
      for (const m of line.matchAll(pattern)) {
        if (ALLOWED.has(`${file} ${m[0]}`)) continue
        problems.push(`${file}:${i + 1} ${m[0]}`)
      }
    })
  }
  return problems
}

describe("type scale", () => {
  it("uses theme text sizes, never arbitrary ones", () => {
    // Below text-xs, use text-2xs (11px) or text-3xs (10px), defined in
    // packages/ui/src/styles/globals.css. Above it, Tailwind's scale.
    expect(violations(ARBITRARY_TEXT_SIZE)).toEqual([])
  })

  it("sizes square boxes and icons with size-*, not h-* w-*", () => {
    // Inside a Button, menu item or select item, leave the icon unsized: the
    // parent sizes any svg without a `size-` class, and ignores h-/w-.
    expect(violations(SPLIT_SIZE)).toEqual([])
  })
})

describe("type scale patterns", () => {
  it.each([
    ["text-[10px]", true],
    ["md:text-[11px]", true],
    ["text-[0.8rem]", true],
    ["text-3xs", false],
    ["max-w-[34ch] text-base", false],
  ])("arbitrary text size in %j: %s", (cls, flagged) => {
    expect([...cls.matchAll(ARBITRARY_TEXT_SIZE)].length > 0).toBe(flagged)
  })

  it.each([
    ["h-3 w-3", true],
    ["flex w-4 h-4", true],
    ["h-6 w-4", false],
    ["h-3 w-3.5", false],
    ["h-[14px] w-[14px]", true],
    ["h-3 w-0 group-hover:w-3", false],
    ["size-3", false],
    ["group-hover:h-3 w-3", false],
  ])("split size in %j: %s", (cls, flagged) => {
    expect([...cls.matchAll(SPLIT_SIZE)].length > 0).toBe(flagged)
  })
})
