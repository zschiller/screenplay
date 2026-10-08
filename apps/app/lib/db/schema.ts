// The full hosted schema. Split so the desktop build can exclude the
// multi-user surface (PRD #404, issue #417):
//
//   - `./schema-core`       — the tables that survive into the local build
//                             (user, kv_store, room, the agent_* log, terminal_tab).
//   - `./schema-comments`   — thread/comment/thread_read, in every build: the
//                             Mac app's host and viewers comment too (#1934).
//   - `./schema-multiuser`  — GitHub OAuth (session/account/verification) and
//                             room_member sharing.
//
// The hosted build (neon) uses this re-export and the full `drizzle/` migration
// history unchanged. The desktop build (PGlite) generates its migrations from
// `schema-core` and `schema-comments` (`drizzle/local`), so the multi-user
// tables are never created on disk, and every code path that would query them
// is gated off behind `@/lib/capabilities`' `multiUserSurface`.
export * from "./schema-core"
export * from "./schema-comments"
export * from "./schema-multiuser"
