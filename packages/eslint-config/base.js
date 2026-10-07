import { defineConfig, globalIgnores } from "eslint/config"
import tsParser from "@typescript-eslint/parser"
import { bannedIconRules } from "./banned-icons.js"
import { jsxTextSpaceRules } from "./design-rules.js"

export const baseConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
  // Parse TypeScript so the icon ban reaches .ts and .tsx files too.
  { files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tsParser } },
  bannedIconRules,
  jsxTextSpaceRules,
])
