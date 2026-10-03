import { test } from "node:test"
import assert from "node:assert/strict"
import { applyEdits, scanMdx, scanTsx } from "../index.js"

const fixMdx = (src) => applyEdits(src, scanMdx(src))
const fixTsx = (src) => applyEdits(src, scanTsx(src))

test("curls apostrophes and quotes in MDX prose", () => {
  assert.equal(
    fixMdx(`It's the canvas's chat. Ask it to "zoom to the cart".\n`),
    `It’s the canvas’s chat. Ask it to “zoom to the cart”.\n`
  )
})

test("looks through emphasis, links and code for context", () => {
  assert.equal(
    fixMdx(`**"Not a git repository"**\n`),
    `**“Not a git repository”**\n`
  )
  assert.equal(
    fixMdx(`_"Ada"_ and \`gh\`'s login\n`),
    `_“Ada”_ and \`gh\`’s login\n`
  )
  assert.equal(
    fixMdx(`A [mockup](/guides/mockups)'s page\n`),
    `A [mockup](/guides/mockups)’s page\n`
  )
  assert.equal(fixMdx(`in the '90s\n`), `in the ’90s\n`)
  assert.equal(fixMdx(`a 'quoted' word\n`), `a ‘quoted’ word\n`)
})

test("pairs quotes that wrap across lines", () => {
  assert.equal(
    fixMdx(`like "try the sign-in page\nthree ways", and\n`),
    `like “try the sign-in page\nthree ways”, and\n`
  )
})

test("leaves code, expressions and other attributes in MDX alone", () => {
  const src = [
    "Run `echo 'hi'` first.",
    "",
    "```sh",
    `echo "it's"`,
    "```",
    "",
    `<Screenshot name="it's" alt="The app's home" />`,
    "",
    `{"it's"}`,
    "",
  ].join("\n")
  assert.equal(
    fixMdx(src),
    src.replace(`alt="The app's home"`, `alt="The app’s home"`)
  )
})

test("curls a page's title and description, not other frontmatter", () => {
  const src = `---\ntitle: Agent's chat\ndescription: "It's \\"here\\""\nslug: it's\n---\n\nHi.\n`
  assert.equal(
    fixMdx(src),
    `---\ntitle: Agent’s chat\ndescription: "It’s “here”"\nslug: it's\n---\n\nHi.\n`
  )
})

test("curls JSX text, entities included", () => {
  assert.equal(
    fixTsx(
      `const a = <p>Then it&apos;s good. Say &quot;hi&quot;, it's "done".</p>`
    ),
    `const a = <p>Then it’s good. Say “hi”, it’s “done”.</p>`
  )
})

test("curls prose attributes and string children", () => {
  assert.equal(
    fixTsx(
      `const a = <Card label="The app's code" title={"a \\"b\\""}>{"it's"}</Card>`
    ),
    `const a = <Card label="The app’s code" title={"a “b”"}>{"it’s"}</Card>`
  )
})

test("curls only in-word apostrophes in other strings", () => {
  assert.equal(
    fixTsx(
      `const copy = { body: "It's saved", cls: "after:content-['+']", html: \`<p class="x">\` }`
    ),
    `const copy = { body: "It’s saved", cls: "after:content-['+']", html: \`<p class="x">\` }`
  )
  assert.equal(fixTsx(`const y = 'it\\'s'`), `const y = 'it’s'`)
})

test("reports the line of each straight quote", () => {
  assert.deepEqual(
    scanMdx(`Fine.\n\nIt's here.\n`).map((e) => e.line),
    [3]
  )
})
