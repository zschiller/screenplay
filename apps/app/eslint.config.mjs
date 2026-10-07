import { defineConfig, globalIgnores } from "eslint/config"
import { nextJsConfig } from "@workspace/eslint-config/next"

export default defineConfig([
  ...nextJsConfig,
  globalIgnores([
    // The design templates' runtimes, built by packages/skill-templates
    "lib/skills/**/*-runtime.js",
    // Screenshot harness state, including the docs capture's built demo
    // site (screenshots/profile.ts; gitignored)
    ".screenshots/**",
  ]),
])
