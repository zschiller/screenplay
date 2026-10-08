/**
 * GitHub access (#1925): whose credentials a Screenplay server talks to
 * GitHub with. Every server-side GitHub call reads its token from here, and
 * git inside a chat learns from here whether to broker credentials or leave
 * the host's own git alone.
 *
 * Built-ins: `oauth-account` (Hosted) and `gh-cli` (the Mac app, Headless).
 * `selectGitHubAccess` (`./index.ts`) picks one.
 */
export interface GitHubAccess {
  /** The implementation's id, e.g. `"gh-cli"`. */
  readonly id: string

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
