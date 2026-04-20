import { defineConfig, globalIgnores } from "eslint/config"

export const reactInternalConfig = defineConfig([
  globalIgnores([
    "dist/**",
    "node_modules/**",
  ]),
])
