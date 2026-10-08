/**
 * GitHub access (spec #1923, #1925): the one place that knows which GitHub a
 * Screenplay server talks to and with whose credentials. Every server-side
 * GitHub call reads its host and token from here, and git inside a chat learns
 * from here whether to broker credentials or leave the host's own git alone.
 *
 * The interface stays small. Built-ins, both on github.com: `oauth-account`
 * (Hosted) and `gh-cli` (the Mac app, Headless). `selectGitHubAccess`
 * (`./index.ts`) picks one; a fork on GitHub Enterprise adds its own there.
 */
export interface GitHubAccess {
  /** The implementation's id, e.g. `"gh-cli"`. */
  readonly id: string

  /**
   * REST base, no trailing slash: `https://api.github.com`, or
   * `https://ghe.corp.example/api/v3` on GitHub Enterprise Server. Every
   * server-side GitHub call is built from this; nothing else names a host.
   */
  readonly apiUrl: string

  /**
   * Web base, no trailing slash: `https://github.com` or
   * `https://ghe.corp.example`. Recognises a repo's remote and builds clone URLs.
   */
  readonly webUrl: string

  /**
   * A token for the server's own REST calls on behalf of `userId`. `null`
   * means GitHub features stay dark, which the UI already handles. Never throws
   * for an expected absence (CLI missing, signed out).
   */
  apiToken(userId: string): Promise<string | null>

  /** How git inside a chat authenticates and authors. */
  readonly git: GitAccess
}

/**
 * - `host`: git already has credentials and an identity (credential helper,
 *   SSH, `gh auth setup-git`). Screenplay installs no helper, rewrites no
 *   remote and stamps no identity.
 * - `brokered`: Screenplay hands git the acting person's token per command,
 *   through the in-sandbox credential helper, and stamps their identity as
 *   author and committer.
 */
export type GitAccess =
  | { kind: "host" }
  | {
      kind: "brokered"
      /** The token git pushes with, or `null` (pushes will fail). */
      token(userId: string): Promise<string | null>
      /** Who commits are authored as, or `null` to stamp no identity. */
      identity(userId: string): Promise<GitIdentity | null>
    }

/** A git author/committer identity: the `Name <email>` stamped onto a commit. */
export interface GitIdentity {
  name: string
  email: string
}
