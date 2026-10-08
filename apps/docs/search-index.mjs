// Builds the Pagefind search index from the prerendered docs pages.
//
// A plain `next build` writes them under .next/server/app. On Vercel, Next
// runs Vercel's build adapter, which writes them to the route cache instead,
// one directory per route: .next/server/route-cache/APP_PAGE/<hash>/$. Each
// of those directories mirrors the site's paths, so indexing all of them
// gives the same URLs as indexing .next/server/app.
//
// The adapter also copies public/ into its deploy output, .next/output/static,
// while `next build` runs, which is before this script. So on Vercel the index
// is written there too, under the basePath; public/_pagefind alone never ships.
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { close, createIndex } from "pagefind"

const server = ".next/server"
const routeCache = join(server, "route-cache/APP_PAGE")

const sites = existsSync(routeCache)
  ? readdirSync(routeCache).map((hash) => join(routeCache, hash, "$"))
  : [join(server, "app")]

const { index, errors } = await createIndex()
if (!index) throw new Error(errors.join("\n"))

let pages = 0
for (const path of sites.filter((site) => existsSync(site))) {
  const added = await index.addDirectory({ path })
  if (added.errors.length) throw new Error(added.errors.join("\n"))
  pages += added.page_count
}
if (pages === 0) {
  throw new Error(`No prerendered pages found in ${sites.join(", ")}`)
}

const vercelStatic = ".next/output/static"
const outputs = ["public/_pagefind"]
if (existsSync(vercelStatic)) outputs.push(join(vercelStatic, "docs/_pagefind"))
for (const outputPath of outputs) {
  const written = await index.writeFiles({ outputPath })
  if (written.errors.length) throw new Error(written.errors.join("\n"))
}
await close()
console.log(
  `Pagefind indexed ${sites.length === 1 ? sites[0] : routeCache} into ${outputs.join(" and ")}.`
)
