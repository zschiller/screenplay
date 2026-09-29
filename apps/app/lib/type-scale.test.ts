import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoDir = fileURLToPath(new URL("../../../", import.meta.url))

/** The app and the shared UI package: everything the app renders. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "apps/app", "packages/ui/src"], {
    cwd: repoDir,
    encoding: "utf8",
  }).split("\n")
}

function sourceFiles(): string[] {
  return trackedFiles()
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
}

// A CSS font size in px or rem (em sizes are relative to the text around them).
const CSS_FONT_SIZE = /font-size:\s*(\d*\.?\d+)(px|rem)/g

/** CSS font sizes under 12px, e.g. `.label { font-size: 11px }`. */
function smallCssFontSizes(): string[] {
  const problems: string[] = []
  // The screenshot fixtures' demo sites are previewed pages, not app UI.
  const css = trackedFiles().filter(
    (f) => f.endsWith(".css") && !f.startsWith("apps/app/screenshots/")
  )
  for (const file of css) {
    const lines = readFileSync(repoDir + file, "utf8").split("\n")
    lines.forEach((line, i) => {
      for (const m of line.matchAll(CSS_FONT_SIZE)) {
        const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1)
        if (px < 12) problems.push(`${file}:${i + 1} ${m[0]}`)
      }
    })
  }
  return problems
}

const ARBITRARY_TEXT_SIZE = /(?<![\w-])text-\[\d*\.?\d+(?:px|rem|em|pt)\]/g
// The steps below text-xs that #1141 retired (11px and 10px).
const RETIRED_TEXT_SIZE = /(?<![\w-])text-(?:2xs|3xs)(?![\w-])/g
// Same-value width and height on one element, e.g. `h-3 w-3`.
const SPLIT_SIZE =
  /(?<![\w:[-])(?:h-([\d.]+|\[[^\]]+\]) w-\1|w-([\d.]+|\[[^\]]+\]) h-\2)(?![\w.\]-])/g

function violations(pattern: RegExp): string[] {
  const problems: string[] = []
  for (const file of sourceFiles()) {
    const lines = readFileSync(repoDir + file, "utf8").split("\n")
    lines.forEach((line, i) => {
      for (const m of line.matchAll(pattern)) {
        problems.push(`${file}:${i + 1} ${m[0]}`)
      }
    })
  }
  return problems
}

describe("type scale", () => {
  it("uses theme text sizes, never arbitrary ones", () => {
    // UI text is text-xs (12px) or text-sm (14px); titles use text-title-*.
    expect(violations(ARBITRARY_TEXT_SIZE)).toEqual([])
  })

  it("sets no UI text under 12px", () => {
    expect(violations(RETIRED_TEXT_SIZE)).toEqual([])
    expect(smallCssFontSizes()).toEqual([])
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
    ["text-2xs", true],
    ["md:text-3xs", true],
    ["text-xs", false],
    ["text-2xs-foo", false],
  ])("retired text size in %j: %s", (cls, flagged) => {
    expect([...cls.matchAll(RETIRED_TEXT_SIZE)].length > 0).toBe(flagged)
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
