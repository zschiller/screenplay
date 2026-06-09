# 8. Optional GitHub API access on the local build — gh-first resolver, device-flow fallback, no-auth floor

Date: 2026-06-09

Status: Accepted

## Context

Stripping the multi-user surface from the local build (#417) removed GitHub
OAuth login — and with it the only thing that ever populated the
`getGitHubToken()` seam there. Git *transport* kept working tokenless (#416:
host-native credentials), but every GitHub *API* feature went dark: the
account-backed repo list came back empty, and Branch-via-API, PR creation, and
Branch auto-naming had no token to run on. Worse, the repo list was the only
way to add a Repo at all, so the desktop app couldn't add a project. Meanwhile
the Repo acquisition + worktree manager built in #410 (resolve a Repo to a
local `.git` from a clone URL **or** a local path) existed but was wired into
no provision path.

A risk worth naming: re-adding anything GitHub-auth-shaped to the local build
could be mistaken for re-introducing the login #417 deliberately removed.

## Decision

- **GitHub connection on the local build is API access only, never a login.**
  No session, no `room_member`, no login gate; the app opens straight into the
  work as the single seeded local user. This is an app capability gated by the
  same `NEXT_PUBLIC_SCREENPLAY_LOCAL` build switch, additive to — not a
  reversal of — #417.

- **One resolver behind the existing seam** (`lib/github-local/`):
  `getGitHubTokenForUser` on the local build resolves in a fixed priority
  order — the **`gh` CLI adapter**'s token (a thin, mockable host-process
  boundary over `gh auth token`; zero-config for anyone who already uses
  `gh`), then a stored **device-flow** token, then `null`. Because resolution
  happens behind `getGitHubToken()`, every API call site (repo listing,
  Branch-via-API, PRs, naming) lights up unmodified, and `null` keeps meaning
  "API features unavailable", which the UI already handles.

- **Device flow, not redirect OAuth, for the on-demand connect.** A desktop
  app has no stable redirect URI and shouldn't run a callback server; the
  GitHub App device flow (user code + browser authorize + poll) fits. The
  client is a pure protocol fold over an injected transport and sleep, so the
  whole lifecycle (`authorization_pending`, `slow_down`, `expired_token`,
  `access_denied`) is unit-tested without network or wall clock.

- **Token storage: OS keychain first, `kv_store` fallback, one interface.**
  The token is consumed by the Node sidecar, so it lives where the sidecar can
  read it directly (`@napi-rs/keyring`), not behind a Rust-side Tauri storage
  plugin that would force an IPC hop per API call. A missing or locked-down
  keychain degrades per-operation to the `kv_store` table behind the same
  `TokenStore` interface. Most users never exercise the store — the `gh`
  adapter answers first.

- **A no-auth floor that always works.** Adding a Repo by **clone URL** or
  **local folder** needs no token: the persisted Repo config records its
  acquisition source (`localPath` beside `cloneUrl`), and the worktree
  provider now routes provisioning through #410's `acquireRepo` + worktree
  manager — a local-path source roots at the user's existing clone, a
  clone-URL source clones once into the managed dir, both add/remove one
  worktree per Branch ref. Without API access, a new Branch's git branch is
  created locally at provision time (from the requested base ref) instead of
  via the API; with a token, the API path is unchanged. The folder picker uses
  a native Tauri dialog via the shell's control server, with a plain path
  input outside the shell.

## Consequences

- The hosted build is untouched: its account-backed picker, API-created
  branches, and brokered-token clone path all keep their existing shape; the
  new picker affordances are gated to the local build.
- The managed worktree layout moved from per-sandbox checkouts
  (`repos/<hash>` bare clones + `trees/<name>`) to acquisition-managed dirs
  (`managed/<hash>` + one worktree per Branch ref) — the convergence #410
  designed. Pre-existing metas still resolve and delete through their recorded
  paths.
- Disconnecting clears only what the app stored; a `gh` login keeps resolving
  until the user logs the CLI out themselves. That asymmetry is the point of
  gh-first resolution and is surfaced in the connect UI's wording.
- Packaging the GitHub App client id (`SCREENPLAY_GITHUB_CLIENT_ID`) into the
  desktop installer belongs to the assembly slice (#418); unset, the connect
  affordance simply doesn't offer itself and the no-auth floor carries the
  experience.
