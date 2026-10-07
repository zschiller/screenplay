// Renders one template, from a Vite build of its React entry as a single IIFE
// plus CSS, into its outputs: the repo skill's page with the bundle inlined
// under the readable top (lib/page.ts), so it publishes as an Artifact, and
// the App Skill's Mockup page, its sample data and the runtime file the page
// loads by reference.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import tailwind from "@tailwindcss/postcss"
import react from "@vitejs/plugin-react"
import { build, type Plugin, type Rolldown } from "vite"

import { appOutputs, type Template } from "../templates.ts"
import { fontsCss } from "./fonts.ts"
import { assemble, stripTokens, tokenBlock } from "./page.ts"

const pkg = fileURLToPath(new URL("../", import.meta.url))

// A closing tag inside inlined code would end the element early
const inline = (code: string, tag: "script" | "style") =>
  code.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1")

// @screenplay.space/state only runs in development builds. The pages are
// production builds, so switch its gate on: it still stays inert unless the
// page is framed, and then only posts the page's picks to the parent.
const sharedStateOn: Plugin = {
  name: "shared-state-on",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("screenplay-state")) return
    return code.replaceAll("process.env.NODE_ENV", '"development"')
  },
}

/** One file the build writes, relative to the repo root. */
export type Output = { path: string; content: string }

export async function render(t: Template): Promise<Output[]> {
  // The same bundle wherever it runs; under Vitest NODE_ENV is "test"
  process.env.NODE_ENV = "production"
  const out = (await build({
    configFile: false,
    mode: "production",
    root: pkg,
    logLevel: "silent",
    plugins: [react(), sharedStateOn],
    css: { postcss: { plugins: [tailwind(), stripTokens] } },
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      rolldownOptions: {
        // packages/ui wraps each icon in a module-level phosphor() call;
        // marked pure, the icons a template doesn't use drop out
        treeshake: { manualPureFunctions: ["phosphor"] },
      },
      lib: {
        entry: `src/${t.name}/main.tsx`,
        formats: ["iife"],
        name: "template",
        fileName: () => "page.js",
        cssFileName: "page",
      },
    },
  })) as Rolldown.RolldownOutput[]
  const files = out.flatMap((o) => o.output)
  const js = files.find((f) => f.type === "chunk")!.code
  const asset = files.find((f) => f.fileName.endsWith(".css"))
  const css = asset?.type === "asset" ? String(asset.source) : ""
  const top = {
    ...t,
    tokens: tokenBlock(css),
    data: readFileSync(`${pkg}src/${t.name}/data.js`, "utf8"),
  }
  const app = appOutputs(t)
  return [
    {
      path: t.out,
      content: assemble({
        ...top,
        body: [
          `<style>${inline(css.trim(), "style")}</style>`,
          `<div id="app"></div>`,
          `<script>${inline(js.trim(), "script")}</script>`,
          "",
        ].join("\n"),
      }),
    },
    // A Mockup folder holds this page as its index.html beside its data.js
    // and captures (#1889); the canvas swaps the reference for the runtime
    // from the Skill when it renders (#1643)
    {
      path: app.page,
      content: assemble({
        ...top,
        mockupFonts: app.fontsRef,
        mockupData: app.dataRef,
        body: [
          `<div id="app"></div>`,
          `<script src="${app.ref}"></script>`,
          "",
        ].join("\n"),
      }),
    },
    // What the agent fills and writes into the folder as data.js
    {
      path: app.data,
      content: [
        `// The ${t.name} page's data: ${app.dataRef} in the Mockup's folder, which its index.html loads. Every capture path it names loads from the Mockup's folder, relative to index.html, so write each capture there at that path.`,
        top.data.trim(),
        "",
      ].join("\n"),
    },
    // The styles go in from the script, so the runtime is one file
    {
      path: app.runtime,
      content: [
        `/* The ${t.name} template's script and styles, built by packages/skill-templates. Never edit it; change the source there and rebuild. */`,
        `(function(){var s=document.createElement("style");s.textContent=${JSON.stringify(css.trim())};document.head.appendChild(s)})();`,
        js.trim(),
        "",
      ].join("\n"),
    },
    // The same file from every template of a Skill
    { path: app.fonts, content: fontsCss() },
  ]
}
