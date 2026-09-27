import { describe, expect, it } from "vitest"

import { boolFlag, listFlag, parseArgs, stringFlag } from "./args"

describe("parseArgs", () => {
  it("reads both --flag value and --flag=value", () => {
    const args = parseArgs(["--label", "before", "--screens=canvas,settings"])
    expect(stringFlag(args, "label")).toBe("before")
    expect(listFlag(args, "screens")).toEqual(["canvas", "settings"])
  })

  it("treats a flag with no value as a boolean", () => {
    const args = parseArgs(["--fresh", "--label", "after"])
    expect(boolFlag(args, "fresh")).toBe(true)
    expect(stringFlag(args, "fresh")).toBeUndefined()
    // The trailing flag still gets its value — a bare boolean before a valued
    // flag must not swallow the next token.
    expect(stringFlag(args, "label")).toBe("after")
  })

  it("does not let a flag swallow the following flag as its value", () => {
    const args = parseArgs(["--no-seed", "--fresh"])
    expect(boolFlag(args, "no-seed")).toBe(true)
    expect(boolFlag(args, "fresh")).toBe(true)
  })

  it("collects positionals", () => {
    const args = parseArgs(["open-canvas", "--theme", "dark"])
    expect(args.positionals).toEqual(["open-canvas"])
    expect(stringFlag(args, "theme")).toBe("dark")
  })

  it("lets --flag=false turn a boolean off", () => {
    // `boot` defaults `--fresh` on, so negating it has to be expressible.
    expect(boolFlag(parseArgs(["--fresh=false"]), "fresh")).toBe(false)
    expect(boolFlag(parseArgs(["--fresh=0"]), "fresh")).toBe(false)
    expect(boolFlag(parseArgs([]), "fresh")).toBe(false)
  })

  it("trims and drops empties in a list flag", () => {
    expect(
      listFlag(parseArgs(["--screens", "canvas, settings ,"]), "screens")
    ).toEqual(["canvas", "settings"])
    expect(listFlag(parseArgs([]), "screens")).toEqual([])
  })
})
