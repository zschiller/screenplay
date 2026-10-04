import { defineConfig, globalIgnores } from "eslint/config"
import { nextJsConfig } from "@workspace/eslint-config/next"

export default defineConfig([
  ...nextJsConfig,
  // The design templates' runtimes, built by packages/skill-templates
  globalIgnores(["lib/skills/**/*-runtime.js"]),
])
