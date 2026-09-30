import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoDir = fileURLToPath(new URL("../../../", import.meta.url))

/** The app and the shared UI package's components, tests aside. */
function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "apps/app", "packages/ui/src"], {
    cwd: repoDir,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
}

// #1148: one icon-button size, `icon-sm` (28px box, 16px glyph).
const RETIRED_ICON_SIZE = /size="icon-xx?s"/g

// The components that render one icon as their whole content.
const ICON_BUTTON_OPEN =
  /<(IconButton|FloatingToolbarButton|Button|InputGroupButton)\b/g

/** The end of the JSX opening tag starting at `from` (skips `{…}` props). */
function openingTagEnd(src: string, from: number): number {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (c === ">" && depth === 0) return i
  }
  return src.length
}

/**
 * Icons sized with `size-*` that sit directly in an icon-only button, where
 * they override the size variant's 16px glyph. An icon nested in another
 * element (a badge, an avatar) is that element's business.
 */
function glyphOverrides(src: string): string[] {
  const problems: string[] = []
  for (const open of src.matchAll(ICON_BUTTON_OPEN)) {
    const tag = open[1]!
    const end = openingTagEnd(src, open.index!)
    const opening = src.slice(open.index!, end + 1)
    if (opening.endsWith("/>")) continue
    // A plain Button only counts when it's an icon size.
    if (tag !== "IconButton" && tag !== "FloatingToolbarButton") {
      if (!/size="icon/.test(opening)) continue
    }
    const close = src.indexOf(`</${tag}>`, end)
    const body = src.slice(end + 1, close)
    let depth = 0
    for (const el of body.matchAll(
      /<(\/?)([\w.]+)((?:[^>{]|\{[^}]*\})*?)(\/?)>/g
    )) {
      const [whole, closing, name, attrs, selfClosing] = el
      if (closing) {
        depth--
        continue
      }
      if (
        depth === 0 &&
        /Icon$/.test(name!) &&
        /className="[^"]*(?<![\w:-])size-/.test(attrs!)
      ) {
        const line = src.slice(0, end + 1 + el.index!).split("\n").length
        problems.push(`${line} ${whole}`)
      }
      if (!selfClosing) depth++
    }
  }
  return problems
}

function violations(check: (src: string) => string[]): string[] {
  return sourceFiles().flatMap((file) =>
    check(readFileSync(repoDir + file, "utf8")).map((p) => `${file}:${p}`)
  )
}

describe("icon button size", () => {
  it("uses icon-sm, never icon-xs or icon-xxs", () => {
    expect(
      violations((src) =>
        src
          .split("\n")
          .flatMap((line, i) =>
            [...line.matchAll(RETIRED_ICON_SIZE)].map((m) => `${i + 1} ${m[0]}`)
          )
      )
    ).toEqual([])
  })

  it("leaves an icon button's glyph to the size variant", () => {
    expect(violations(glyphOverrides)).toEqual([])
  })
})

describe("icon button size patterns", () => {
  it.each([
    ['<IconButton label="x"><XIcon className="size-3" /></IconButton>', 1],
    ['<IconButton label="x"><XIcon /></IconButton>', 0],
    ['<Button size="icon-sm"><XIcon className="size-3.5" /></Button>', 1],
    ['<Button size="sm"><XIcon className="size-3.5" />Close</Button>', 0],
    [
      '<IconButton label="x"><span className="badge"><EyeIcon className="size-2.5" /></span></IconButton>',
      0,
    ],
    [
      '<IconButton label="x" onClick={() => go()}>{on ? <CheckIcon className="size-3" /> : <CopyIcon />}</IconButton>',
      1,
    ],
    [
      '<IconButton label="x"><XIcon className="text-muted-foreground" /></IconButton>',
      0,
    ],
  ])("glyph overrides in %j: %i", (src, count) => {
    expect(glyphOverrides(src)).toHaveLength(count)
  })
})
