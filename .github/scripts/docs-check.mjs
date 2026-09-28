// Docs check: a pull request that changes product code either updates the
// docs (apps/docs/content) or says why it doesn't need to, with a line like
//
//   Docs: not needed, internal refactor
//
// in its description. See the "Docs" section of AGENTS.md.
//
// Usage (CI): node .github/scripts/docs-check.mjs <base-ref>
// Reads the PR description from the event at $GITHUB_EVENT_PATH.

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/** Code whose behavior the docs describe. Tests and fixtures don't count. */
const PRODUCT = [
  /^apps\/app\/(app|components|hooks|lib)\//,
  /^apps\/app\/(instrumentation|proxy)\.ts$/,
  /^packages\/screenplay-(knobs|state)\/index\.(js|d\.ts)$/,
]
const NOT_PRODUCT = /\.test\.[jt]sx?$|\/fixture-|\/test\//

const DOCS = /^apps\/docs\/content\//

/** Where to look first, by path. Only a hint: any docs change passes. */
const HINTS = [
  [/lib\/canvas\/shortcuts|keyboard|hotkey/, "guides/keyboard-shortcuts.mdx"],
  [/components\/canvas|lib\/canvas\//, "guides/canvas.mdx"],
  [/frame/, "guides/frames.mdx"],
  [/components\/agent|lib\/agent\/|lib\/chat/, "guides/agent.mdx"],
  [/terminal/, "guides/terminals.mdx"],
  [/comment|share-room|presence/, "guides/collaboration.mdx"],
  [/components\/play|app\/play\//, "guides/play-mode.mdx"],
  [
    /components\/home|app\/\(home\)\/(page|files)|folder|home-/,
    "guides/home.mdx",
  ],
  [/app\/\(home\)\/settings|settings/, "guides/settings.mdx"],
  [/branch|workspace|components\/panels/, "guides/workspaces.mdx"],
  [/repo-|add-repo|local-setup|repo-configs/, "guides/projects.mdx"],
  [/lib\/skills|skill-/, "building/skills.mdx"],
  [/screenplay-knobs|lib\/knobs/, "building/knobs.mdx"],
  [/screenplay-state|lib\/yjs\//, "building/shared-state.mdx"],
  [/lib\/sandbox/, "self-hosting/configuration/sandbox-provider.mdx"],
  [/lib\/blob|thumbnail/, "self-hosting/configuration/blob-store.mdx"],
  [/lib\/yjs-host/, "self-hosting/configuration/yjs-host.mdx"],
  [/lib\/db\/|drizzle/, "self-hosting/database.mdx"],
  [
    /lib\/desktop|local-mode|local-user/,
    "self-hosting/configuration/desktop-app.mdx",
  ],
  [/auth/, "self-hosting/github-oauth.mdx"],
]

export function isProduct(file) {
  return PRODUCT.some((re) => re.test(file)) && !NOT_PRODUCT.test(file)
}

/** The reason given on a `Docs:` line, or null if there's none. */
export function docsDeclaration(body) {
  for (const line of (body ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]\s*)?\**docs\**:\**\s*(.*)$/i)
    if (!m) continue
    const reason = m[1].replace(/<!--.*?-->/g, "").trim()
    if (reason) return reason
  }
  return null
}

export function suggestPages(files) {
  const pages = new Set()
  for (const file of files) {
    const hit = HINTS.find(([re]) => re.test(file))
    if (hit) pages.add(`apps/docs/content/${hit[1]}`)
  }
  return [...pages]
}

/** @returns {{ ok: boolean, message: string }} */
export function checkDocs(files, body) {
  const product = files.filter(isProduct)
  if (product.length === 0) {
    return { ok: true, message: "No product code changed." }
  }
  const docs = files.filter((file) => DOCS.test(file))
  if (docs.length > 0) {
    return { ok: true, message: `Docs updated (${docs.length} file(s)).` }
  }
  const reason = docsDeclaration(body)
  if (reason) {
    return { ok: true, message: `No docs change. Declared: "${reason}"` }
  }
  const pages = suggestPages(product)
  return {
    ok: false,
    message: [
      `This PR changes product code (${product.length} file(s)) but not the docs in apps/docs/content.`,
      "",
      "Either update the page(s) that describe what changed, or add a line to the PR description saying why no docs change is needed, e.g.",
      "",
      "    Docs: not needed, internal refactor",
      ...(pages.length
        ? [
            "",
            "Pages that likely cover this change:",
            ...pages.map((p) => `  - ${p}`),
          ]
        : []),
    ].join("\n"),
  }
}

function main() {
  const base = process.argv[2]
  if (!base) throw new Error("usage: docs-check.mjs <base-ref>")
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  const { ok, message } = checkDocs(files, event.pull_request?.body)
  console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Docs check\n\n${ok ? "Passed." : "Failed."}\n\n\`\`\`\n${message}\n\`\`\`\n`
    )
  }
  if (!ok) {
    console.log(
      "::error title=Docs check::Update the docs or add a 'Docs:' line to the PR description"
    )
    process.exit(1)
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
