import { Pool } from "pg"

const globalForPool = globalThis as unknown as {
  __screenplayPgPool?: Pool
  __screenplayPgInit?: Promise<void>
}

export const pool =
  globalForPool.__screenplayPgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL })

if (process.env.NODE_ENV !== "production") {
  globalForPool.__screenplayPgPool = pool
}

// Schema is applied idempotently on first use instead of via an external
// migration tool — point DATABASE_URL at an empty database and go. Adding a
// column means adding an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` below.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "account_provider_idx" ON "account" ("providerId", "accountId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "user_organization" (
  "user_id" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "kv" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "kv_expires_at_idx"
  ON "kv" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
`

async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL)
}

/**
 * Ensures the schema exists. Cached on globalThis so concurrent callers share
 * a single init promise and the DDL runs at most once per process.
 */
export function ensureSchema(): Promise<void> {
  if (!globalForPool.__screenplayPgInit) {
    globalForPool.__screenplayPgInit = applySchema().catch((err) => {
      // Clear the cache so a transient failure (e.g. DB not yet reachable)
      // doesn't poison future requests — the next caller retries init.
      globalForPool.__screenplayPgInit = undefined
      throw err
    })
  }
  return globalForPool.__screenplayPgInit
}

/**
 * Like pool.query, but waits for the schema to exist first. Prefer this over
 * raw `pool.query` for code paths that may hit tables we manage here.
 */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  ...args: Parameters<typeof pool.query<T>>
): ReturnType<typeof pool.query<T>> {
  await ensureSchema()
  return pool.query<T>(...args)
}
