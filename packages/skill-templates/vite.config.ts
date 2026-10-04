// Dev server for the skill templates: `pnpm dev` lists them at /, and
// /<name>/ serves one with its sample data, hot reloading as you edit.
// `pnpm build` (scripts/build.ts) writes the committed pages.

import { readFileSync } from "node:fs"
import tailwind from "@tailwindcss/postcss"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

import { assemble, stripTokens, tokenBlock } from "./lib/page.ts"
import { templates } from "./templates.ts"

// Captures the sample data refers to (r2/a-light.png) don't exist: serve a
// labelled placeholder for any missing image so the layout reads.
function placeholder(path: string) {
  const dark = /-dark\.\w+$/.test(path)
  const [bg, fg] = dark ? ["#1b1b1a", "#a3a39e"] : ["#f1f1ef", "#5d5d59"]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="${bg}"/><text x="640" y="410" font-family="monospace" font-size="32" fill="${fg}" text-anchor="middle">${path}</text></svg>`
}

function pages(): Plugin {
  return {
    name: "skill-template-pages",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://dev")
        const t = templates.find((t) => url.pathname.startsWith(`/${t.name}/`))
        if (url.pathname === "/") {
          res.setHeader("content-type", "text/html")
          res.end(
            `<title>Skill templates</title><ul>${templates.map((t) => `<li><a href="/${t.name}/">${t.name}</a></li>`).join("")}</ul>`
          )
          return
        }
        if (!t) return next()
        const rest = url.pathname.slice(t.name.length + 2)
        if (/\.(png|webp|jpe?g|gif)$/.test(rest)) {
          res.setHeader("content-type", "image/svg+xml")
          res.end(placeholder(rest))
          return
        }
        if (rest !== "") return next()
        const html = assemble({
          ...t,
          tokens: tokenBlock(),
          data: readFileSync(`src/${t.name}/data.js`, "utf8"),
          body: `<div id="app"></div><script type="module" src="/src/${t.name}/main.tsx"></script>`,
        })
        res.setHeader("content-type", "text/html")
        res.end(await server.transformIndexHtml(req.url ?? "/", `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${html}`))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), pages()],
  css: { postcss: { plugins: [tailwind(), stripTokens] } },
})
