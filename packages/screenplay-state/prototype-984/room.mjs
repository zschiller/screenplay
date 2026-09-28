// PROTOTYPE (#984), throwaway. `npm install && npm start` in this folder, then
// open http://localhost:4984/__room.
//
// Builds the Northwind demo site (apps/app/screenshots/docs/northwind) with
// this prototype's overlay, injects the real Sandbox Bridge plus
// auto-react.js, and serves a "room" page with two viewers of one frame. The
// room relays messages the way the canvas + Yjs do today, so what drifts here
// drifts in a real room.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../..")
const out = join(here, ".build")
const PORT = Number(process.env.PORT || 4984)

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(join(repo, "apps/app/screenshots/docs/northwind"), join(out, "site"), { recursive: true })
await cp(join(here, "overlay"), join(out, "site"), { recursive: true })
const extraCss = `
.faq{max-width:720px;margin:0 auto;padding:8px 24px 48px}.faq details{border-bottom:1px solid #eef0f4;padding:14px 4px}.faq summary{font-weight:600;cursor:pointer}
.modal-backdrop{position:fixed;inset:0;background:#0f172a66;display:grid;place-items:center}.modal{background:#fff;border-radius:14px;padding:24px;min-width:280px;display:grid;gap:12px}
.newsletter{display:flex;gap:8px;justify-content:center;padding:24px}.newsletter input{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font:inherit}`
await writeFile(join(out, "site/src/styles.css"), (await readFile(join(out, "site/src/styles.css"), "utf8")) + extraCss)

const nm = join(here, "node_modules")
await build({
  entryPoints: [join(out, "site/src/main.jsx")],
  outdir: join(out, "assets"),
  entryNames: "app",
  assetNames: "[name]-[hash]",
  publicPath: "/assets",
  bundle: true,
  format: "esm",
  jsx: "automatic",
  loader: { ".js": "jsx", ".woff2": "file", ".woff": "file" },
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "@screenplay.space/state": process.env.UNPATCHED ? resolve(here, "..") : join(here, "state-patched.js"),
    "@screenplay.space/knobs": join(repo, "packages/screenplay-knobs"),
    "proto984/share-store": join(here, "share-store.js"),
    react: join(nm, "react"),
    "react-dom": join(nm, "react-dom"),
    zustand: join(nm, "zustand"),
  },
  nodePaths: [nm],
  logLevel: "error",
})

const bridge = await readFile(join(repo, "apps/app/lib/sandbox-bridge/bridge.js"), "utf8")
const auto = await readFile(join(here, "auto-react.js"), "utf8")
const siteHtml = (await readFile(join(out, "site/index.html"), "utf8"))
  .replace(/<script type="module" src="[^"]*"><\/script>/, '<script type="module" src="/assets/app.js"></script>')
  .replace("</head>", `<link rel="stylesheet" href="/assets/app.css" />\n<script>${bridge}</script>\n<script>${auto}</script>\n</head>`)
const roomHtml = await readFile(join(here, "room.html"), "utf8")

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" }
let likes = 12 // the "server data" the prototype's dev server owns

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  if (url.pathname === "/__room") {
    res.writeHead(200, { "content-type": "text/html" })
    return res.end(roomHtml)
  }
  if (url.pathname === "/api/likes") {
    if (req.method === "POST") likes++
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify({ likes }))
  }
  const type = TYPES[extname(url.pathname)]
  if (type && url.pathname.startsWith("/assets/")) {
    try {
      const body = await readFile(join(out, url.pathname))
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" })
      return res.end(body)
    } catch {}
  }
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
  res.end(siteHtml)
}).listen(PORT, () => console.log(`room: http://localhost:${PORT}/__room`))
