import { nextJsConfig } from "@workspace/eslint-config/next"

const config = [
  ...nextJsConfig,
  // Pagefind's search bundle, written here by `next build` (gitignored).
  { ignores: ["public/_pagefind/**"] },
]

export default config
