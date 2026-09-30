// Builds the Pagefind search index from the prerendered docs pages.
//
// A plain `next build` writes them under .next/server/app. On Vercel, Next
// runs Vercel's build adapter, which writes them to the route cache instead,
// one directory per route: .next/server/route-cache/APP_PAGE/<hash>/$. Each
// of those directories mirrors the site's paths, so indexing all of them
// gives the same URLs as indexing .next/server/app.
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

const written = await index.writeFiles({ outputPath: "public/_pagefind" })
if (written.errors.length) throw new Error(written.errors.join("\n"))
await close()
console.log(`Pagefind indexed ${sites.length === 1 ? sites[0] : routeCache}.`)
