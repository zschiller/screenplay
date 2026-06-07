import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const rootDir = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // `server-only` throws when imported outside an RSC bundle; stub it so
      // server-only modules can be unit-tested under plain Node.
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./test/stubs/server-only.ts", import.meta.url)
        ),
      },
      // Mirror the tsconfig `@/*` path alias. The regex keeps it from matching
      // unrelated scoped packages like `@workspace/ui`.
      { find: /^@\//, replacement: `${rootDir}` },
    ],
  },
  // The app's tsconfig sets `jsx: "preserve"` (for Next.js), which the bundler
  // would otherwise inherit and leave raw JSX in the output. Force the
  // automatic runtime so component (`.test.tsx`) tests transform correctly.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Default to node; component tests opt into jsdom via a per-file
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
  },
})
