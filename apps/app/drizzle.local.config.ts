import { defineConfig } from "drizzle-kit"

// The desktop build's migration set. Generated from `schema-core` alone — the
// multi-user surface (`schema-multiuser`: auth, room_member, comments) is
// excluded from the local build (PRD #404, issue #417) — and applied at boot by
// the PGlite backend (`lib/db/pglite.ts`). The hosted neon build keeps the full
// `drizzle/` history via `drizzle.config.ts`.
//
// Regenerate with: `pnpm drizzle-kit generate --config drizzle.local.config.ts`
export default defineConfig({
  schema: "./lib/db/schema-core.ts",
  out: "./drizzle/local",
  dialect: "postgresql",
})
