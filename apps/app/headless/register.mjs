// Lets `pnpm headless` import the server's own modules outside Next: their
// `import "server-only"` guard is Next's to resolve, so here it's an empty
// module.

import { register } from "node:module"

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
