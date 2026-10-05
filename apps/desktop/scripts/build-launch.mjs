// Build the launch screen's spinner into `dist/launch/`, next to the
// `dist/index.html` the window paints first.
//
//   pnpm --filter desktop build:launch
//
// The spinner (`launch/spinner.ts`) runs the homepage hero's fluid solver
// (`apps/homepage/components/marketing/site/fluid.ts`), so both are compiled
// here as they are, one module each, and the spinner's import is pointed at
// the compiled copy. Tauri runs this before every `tauri dev` and
// `tauri build` (`build.before*Command` in tauri.conf.json); the output is
// gitignored with the rest of dist/, apart from index.html.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, "..")
const outDir = join(desktopDir, "dist", "launch")
const FLUID_IMPORT = "../../homepage/components/marketing/site/fluid"

const sources = [
  {
    from: join(
      desktopDir,
      "..",
      "homepage",
      "components",
      "marketing",
      "site",
      "fluid.ts"
    ),
    to: "fluid.js",
  },
  { from: join(desktopDir, "launch", "spinner.ts"), to: "spinner.js" },
]

mkdirSync(outDir, { recursive: true })
for (const { from, to } of sources) {
  const { outputText } = ts.transpileModule(readFileSync(from, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: from,
  })
  const js = outputText.replace(`"${FLUID_IMPORT}"`, `"./fluid.js"`)
  if (to === "spinner.js" && !js.includes(`"./fluid.js"`)) {
    throw new Error(`spinner.ts no longer imports ${FLUID_IMPORT}`)
  }
  writeFileSync(join(outDir, to), js)
}
console.log(
  `[build-launch] wrote ${sources.map((s) => s.to).join(", ")} to dist/launch`
)
