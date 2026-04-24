-- Generic key/value table replacing the Upstash KV backend.
-- `expires_at` is NULL for values that never expire. `get` filters expired rows
-- lazily (no background cleanup needed for the small number of keys this app
-- writes), and the `nx`-style set path re-claims expired rows.

CREATE TABLE IF NOT EXISTS "kv" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index so the occasional "delete expired" sweep (if ever added)
-- doesn't have to scan the whole table.
CREATE INDEX IF NOT EXISTS "kv_expires_at_idx"
  ON "kv" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
