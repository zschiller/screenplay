import assert from "node:assert/strict"
import { test } from "node:test"

import { checkDocs, docsDeclaration, isProduct } from "./docs-check.mjs"

test("product code excludes tests, fixtures and non-app paths", () => {
  assert.equal(isProduct("apps/app/components/canvas/toolbar.tsx"), true)
  assert.equal(isProduct("apps/app/lib/agent/tools.ts"), true)
  assert.equal(isProduct("packages/screenplay-knobs/index.d.ts"), true)
  assert.equal(isProduct("apps/app/lib/agent/tools.test.ts"), false)
  assert.equal(isProduct("apps/app/lib/fixture-world.ts"), false)
  assert.equal(isProduct("apps/app/screenshots/screens.ts"), false)
  assert.equal(isProduct("apps/docs/content/guides/canvas.mdx"), false)
  assert.equal(isProduct(".github/workflows/ci.yml"), false)
})

test("passes when no product code changed", () => {
  assert.equal(checkDocs(["README.md", "apps/app/lib/a.test.ts"], "").ok, true)
})

test("passes when the docs changed alongside product code", () => {
  const files = [
    "apps/app/lib/canvas/snap.ts",
    "apps/docs/content/guides/canvas.mdx",
  ]
  assert.equal(checkDocs(files, "").ok, true)
})

test("passes with a Docs: line, fails without one", () => {
  const files = ["apps/app/lib/canvas/snap.ts"]
  assert.equal(checkDocs(files, "Docs: not needed, refactor").ok, true)
  const failed = checkDocs(files, "Some description")
  assert.equal(failed.ok, false)
  assert.match(failed.message, /guides\/canvas\.mdx/)
})

test("reads the Docs: line in common markdown shapes", () => {
  assert.equal(docsDeclaration("**Docs:** internal only"), "internal only")
  assert.equal(
    docsDeclaration("- docs: updated elsewhere"),
    "updated elsewhere"
  )
  assert.equal(docsDeclaration("Docs: <!-- why not? -->"), null)
  assert.equal(docsDeclaration("Docs:"), null)
  assert.equal(docsDeclaration(null), null)
})
