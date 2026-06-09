// The full hosted schema. Split into two halves so the desktop build can
// exclude the multi-user surface (PRD #404, issue #417):
//
//   - `./schema-core`       — the tables that survive into the local build
//                             (user, kv_store, room, the agent_* log, terminal_tab).
//   - `./schema-multiuser`  — GitHub OAuth (session/account/verification),
//                             room_member sharing, and thread/comment/thread_read.
//
// The hosted build (neon) uses this re-export and the full `drizzle/` migration
// history unchanged. The desktop build (PGlite) generates its migrations from
// `schema-core` alone (`drizzle/local`), so the multi-user tables are never
// created on disk, and every code path that would query them is gated off
// behind `@/lib/local-mode`'s `isLocalBuild`.
export * from "./schema-core"
export * from "./schema-multiuser"
