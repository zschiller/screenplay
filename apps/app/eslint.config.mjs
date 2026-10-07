import { defineConfig, globalIgnores } from "eslint/config"
import { nextJsConfig } from "@workspace/eslint-config/next"

export default defineConfig([
  ...nextJsConfig,
  {
    // Hosted runs neon-http, whose `transaction()` throws (#1899). Tests are
    // exempt; the shared test handle mirrors the throw.
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='transaction']",
          message:
            "Hosted neon-http has no transactions; write one statement with data-modifying CTEs (see lib/comments.ts).",
        },
      ],
    },
  },
  globalIgnores([
    // The design templates' runtimes, built by packages/skill-templates
    "lib/skills/**/*-runtime.js",
    // Screenshot harness state, including the docs capture's built demo
    // site (screenshots/profile.ts; gitignored)
    ".screenshots/**",
  ]),
])
