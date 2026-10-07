import { describe, expect, it } from "vitest"

import { looksLikeCloneUrl } from "@/lib/github-local/parse-remote"

describe("looksLikeCloneUrl", () => {
  it.each([
    ["https://github.com/acme/widgets"],
    ["https://github.com/acme/widgets.git"],
    ["http://example.com/acme/widgets.git"],
    ["https://x-access-token@github.com/acme/widgets.git"],
    ["git@github.com:acme/widgets.git"],
    ["ssh://git@github.com/acme/widgets.git"],
    ["git://github.com/acme/widgets.git"],
    ["file:///home/me/code/widgets"],
    ["  https://github.com/acme/widgets.git  "],
  ])("recognizes clone URL %s", (input) => {
    expect(looksLikeCloneUrl(input)).toBe(true)
  })

  it.each([
    ["acme/widgets"],
    ["widgets"],
    ["my cool repo"],
    ["facebook"],
    ["github.com/acme/widgets"],
    [""],
    ["   "],
    ["acme widgets.git"],
  ])("does not surface an Add-URL row for %s", (input) => {
    expect(looksLikeCloneUrl(input)).toBe(false)
  })
})
