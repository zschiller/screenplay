import { nextJsConfig } from "@workspace/eslint-config/next"

export default [
  ...nextJsConfig,
  // Pagefind's search bundle, written here by `next build` (gitignored).
  { ignores: ["public/_pagefind/**"] },
]
