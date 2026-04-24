import { config as loadEnv } from "dotenv"
import { defineConfig } from "drizzle-kit"

// Load .env.local so `drizzle-kit push` / `drizzle-kit studio` pick up
// DATABASE_URL the same way Next.js does at runtime.
loadEnv({ path: ".env.local" })

export default defineConfig({
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  casing: "camelCase",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
})
