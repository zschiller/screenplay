import { execFileSync } from "node:child_process"
import { cp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

import { BRIDGE_JS } from "@/lib/sandbox-bridge"

import type { PreviewServerHandle } from "../lib/preview-server"

/**
 * The **demo site** the docs screenshots are taken of: "Northwind", a small
 * React marketing site (`./northwind/`) that uses the real
 * `@screenplay.space/knobs` and `@screenplay.space/state` packages.
 *
 * Where the design-review harness serves flat wireframes on purpose, the docs
 * want frames that look like a product someone is building. So each Workspace
 * of the docs world gets a real build of this site — its own **variant**, with
 * the edits its agent turn describes applied — served from its own origin with
 * the genuine Sandbox Bridge injected, exactly as a Workspace dev server would
 * be. The same {@link WORKSPACE_EDITS} feed the chat transcripts' diffs, so a
 * frame always shows the change its chat claims to have made.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, "northwind")
const APP_MODULES = resolve(here, "../../node_modules")
const PACKAGES = resolve(here, "../../../../packages")

/** A find-and-replace edit, the shape an agent's edit tool call carries. */
export interface SiteEdit {
  path: string
  find: string
  replace: string
}

const HERO_ROW = `<div className="row"><Link to="/pricing" className="btn">Start free trial</Link><a className="btn outline">Book a demo</a></div>`

/** The edits each Workspace's branch carries on top of `main`, keyed by sandbox name. */
export const WORKSPACE_EDITS: Record<string, SiteEdit[]> = {
  "hero-gradient-trust-line": [
    {
      path: "src/pages/Home.jsx",
      find: HERO_ROW,
      replace: `${HERO_ROW}\n        <p className="trust">Trusted by 4,000+ product teams</p>`,
    },
    {
      path: "src/styles.css",
      find: ".pill{",
      replace:
        ".hero h1{background:linear-gradient(90deg,var(--accent),#06b6d4);-webkit-background-clip:text;background-clip:text;color:transparent}\n.hero .trust{margin:18px auto 0;font-size:13px;color:#94a3b8;font-weight:500}\n.pill{",
    },
  ],
  "pricing-faq": [
    {
      path: "src/pages/Pricing.jsx",
      find: "      </section>\n    </main>",
      replace: `      </section>
      <section className="faq">
        <h2>Frequently asked questions</h2>
        {[["Can I change plans later?", "Yes — upgrade or downgrade at any time and we'll prorate the difference."], ["What counts as an event?", "Any tracked action: a page view, a click, or a custom event you send from your app."], ["Do you offer discounts for startups?", "Teams under two years old get 50% off Growth for their first year."], ["Is there a free trial?", "Every paid plan starts with a 14-day trial. No credit card required."]].map(([q, a]) => (
          <details key={q}><summary>{q}</summary><p>{a}</p></details>
        ))}
      </section>
    </main>`,
    },
    {
      path: "src/styles.css",
      find: ".footer{",
      replace: `.faq{max-width:720px;margin:0 auto;padding:8px 24px 72px}.faq h2{font-size:28px;letter-spacing:-.03em;margin-bottom:18px;text-align:center}
.faq details{border-bottom:1px solid #eef0f4;padding:18px 4px}.faq summary{font-weight:600;cursor:pointer;list-style:none}.faq summary:before{content:"+";color:var(--accent);margin-right:10px;font-weight:700}.faq details[open] summary:before{content:"–"}.faq details p{color:#64748b;margin-top:10px;line-height:1.55}
.footer{`,
    },
  ],
}

/** A source file of the demo site as it reads on `main`, for a transcript's `read` call. */
export function readSource(path: string): Promise<string> {
  return readFile(join(SOURCE, path), "utf8")
}

/**
 * Build one variant of the site into `outDir`: copy the source, apply the
 * Workspace's edits, and bundle it. React runs in development mode because that
 * is where the knobs package publishes its controls to the canvas — the same
 * build mode a Workspace's dev server runs in.
 */
export async function buildVariant(
  outDir: string,
  edits: readonly SiteEdit[]
): Promise<void> {
  const srcDir = join(outDir, "src-tree")
  await rm(outDir, { recursive: true, force: true })
  await cp(SOURCE, srcDir, { recursive: true })
  for (const edit of edits) {
    const file = join(srcDir, edit.path)
    const before = await readFile(file, "utf8")
    if (!before.includes(edit.find)) {
      throw new Error(
        `demo site edit: "${edit.find.slice(0, 40)}…" not found in ${edit.path}`
      )
    }
    await writeFile(file, before.replace(edit.find, edit.replace))
  }

  await build({
    entryPoints: [join(srcDir, "src/main.jsx")],
    outdir: join(outDir, "assets"),
    entryNames: "app",
    assetNames: "[name]-[hash]",
    publicPath: "/assets",
    bundle: true,
    format: "esm",
    jsx: "automatic",
    loader: { ".js": "jsx", ".woff2": "file", ".woff": "file" },
    define: { "process.env.NODE_ENV": '"development"' },
    // Built against this repo's knobs and state packages (not their published
    // versions) and the app's own React, so the site needs no install of its
    // own. React is pinned to one copy: the packages resolve it too, and two
    // Reacts in one bundle break every hook.
    alias: {
      "@screenplay.space/knobs": join(PACKAGES, "screenplay-knobs"),
      "@screenplay.space/state": join(PACKAGES, "screenplay-state"),
      react: join(APP_MODULES, "react"),
      "react-dom": join(APP_MODULES, "react-dom"),
    },
    nodePaths: [APP_MODULES],
    logLevel: "error",
  })

  const html = (await readFile(join(srcDir, "index.html"), "utf8"))
    .replace(
      /<script type="module" src="[^"]*"><\/script>/,
      '<script type="module" src="/assets/app.js"></script>'
    )
    .replace(
      "</head>",
      `<link rel="stylesheet" href="/assets/app.css" />\n<script>${BRIDGE_JS}</script>\n</head>`
    )
  await writeFile(join(outDir, "index.html"), html)
  await rm(srcDir, { recursive: true, force: true })
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
}

/** One Workspace's preview: which variant it serves, and on which port. */
export interface DemoPreview {
  sandboxName: string
  port: number
}

export function previewOrigin(port: number): string {
  return `http://127.0.0.1:${port}`
}

/**
 * Build every Workspace's variant under `stateDir` and serve each from its own
 * origin — a Workspace's dev server is a whole origin, so the site's absolute
 * asset paths and client-side routes work unchanged. Unknown paths fall back to
 * `index.html`, as a dev server's SPA fallback would.
 */
export async function startDemoPreviews(
  stateDir: string,
  previews: readonly DemoPreview[]
): Promise<PreviewServerHandle> {
  const variants = new Map<string, string>()
  for (const { sandboxName } of previews) {
    const key = WORKSPACE_EDITS[sandboxName] ? sandboxName : "main"
    if (variants.has(key)) continue
    const dir = join(stateDir, "demo-site", key)
    await buildVariant(dir, WORKSPACE_EDITS[key] ?? [])
    variants.set(key, dir)
  }

  const servers: Server[] = []
  try {
    for (const preview of previews) {
      const dir = variants.get(preview.sandboxName) ?? variants.get("main")!
      servers.push(await serveDir(dir, preview.port))
    }
  } catch (err) {
    await Promise.all(servers.map(closeServer))
    throw err
  }

  return {
    origin: previewOrigin(previews[0]?.port ?? 0),
    started: true,
    stop: async () => {
      await Promise.all(servers.map(closeServer))
    },
  }
}

function serveDir(dir: string, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://x").pathname
    )
    const file = join(dir, pathname)
    let body: Buffer
    let type = CONTENT_TYPES[extname(file)]
    try {
      if (!file.startsWith(dir) || !type || pathname === "/") throw new Error()
      body = await readFile(file)
    } catch {
      body = await readFile(join(dir, "index.html"))
      type = CONTENT_TYPES[".html"]
    }
    res.writeHead(200, {
      "content-type": type!,
      "cache-control": "no-store",
      "x-screenplay-fixture-preview": "1",
    })
    res.end(body)
  })
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolvePromise(server)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.closeAllConnections?.()
    server.close(() => resolvePromise())
  })
}

/**
 * A git checkout of the demo site at `dir`, for the screens that open a
 * Project from a folder: the add-Project flow reads its `package.json` to
 * detect the run settings, as it would a real clone.
 */
export async function ensureDemoCheckout(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await cp(SOURCE, dir, { recursive: true })
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "northwind-web",
        private: true,
        type: "module",
        scripts: { dev: "vite", build: "vite build" },
        dependencies: {
          "@screenplay.space/knobs": "^0.1.4",
          "@screenplay.space/state": "^0.1.3",
          react: "^19.1.0",
          "react-dom": "^19.1.0",
        },
        devDependencies: { "@vitejs/plugin-react": "^5.0.0", vite: "^7.0.0" },
      },
      null,
      2
    )}\n`
  )
  await writeFile(join(dir, ".gitignore"), "node_modules\ndist\n")
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Sam Rivera",
        GIT_AUTHOR_EMAIL: "sam@northwind.dev",
        GIT_COMMITTER_NAME: "Sam Rivera",
        GIT_COMMITTER_EMAIL: "sam@northwind.dev",
      },
    })
  git("init", "-q", "-b", "main")
  git("add", "-A")
  git("commit", "-qm", "Northwind marketing site")
}
