// Lets `pnpm headless` import the server's own modules outside Next: their
// `import "server-only"` guard is Next's to resolve, so here it's an empty
// module. It also reads them as the Headless profile, so their select modules
// pick what the server will.

import { register } from "node:module"

process.env.NEXT_PUBLIC_SCREENPLAY_PROFILE = "headless"

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,", shortCircuit: true }
      }
      return next(specifier, context)
    }
  `)}`
)
