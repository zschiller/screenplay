import { describe, expect, it } from "vitest"

import { parseJsonc, stripJsonc } from "./jsonc"

describe("parseJsonc", () => {
  it("allows line and block comments and trailing commas", () => {
    const text = `{
      // the host
      "a": 1, /* inline */
      "b": [1, 2,],
    }`
    expect(parseJsonc(text)).toEqual({ a: 1, b: [1, 2] })
  })

  it("leaves comment-like text and commas inside strings alone", () => {
    expect(parseJsonc(`{ "url": "https://x//y/*z*/", "s": "a,}" }`)).toEqual({
      url: "https://x//y/*z*/",
      s: "a,}",
    })
    expect(parseJsonc(`{ "q": "say \\"hi\\" // not a comment" }`)).toEqual({
      q: 'say "hi" // not a comment',
    })
  })

  it("keeps positions, so a parse error points at the original text", () => {
    const text = `{\n  // note\n  "a": 1,,\n}`
    expect(stripJsonc(text)).toHaveLength(text.length)
    expect(stripJsonc(text).split("\n")).toHaveLength(4)
    expect(() => parseJsonc(text)).toThrow(SyntaxError)
  })
})
