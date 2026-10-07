import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import { bannedIconRules } from "./banned-icons.js"
import { jsxTextSpaceRules } from "./design-rules.js"

export const nextJsConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  bannedIconRules,
  jsxTextSpaceRules,
  {
    rules: {
      // Honor the repo-wide convention of prefixing intentionally-unused
      // bindings with an underscore (args, caught errors, and rest siblings).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
])
