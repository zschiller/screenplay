/**
 * The environment a host child process (a user project's dev server, its
 * install, a terminal shell) inherits from this app's own process.
 *
 * On the desktop the app itself runs as a Next.js standalone server, whose
 * `server.js` exports Next's private runtime state into `process.env` —
 * `__NEXT_PRIVATE_STANDALONE_CONFIG` above all, which points at paths in
 * Screenplay's own tree. A user project's `next dev` reads those same vars and
 * crashes (ERR_INVALID_ARG_TYPE, "path" is undefined) trying to use our
 * config instead of its own. `NODE_ENV=production`, `NEXT_DEPLOYMENT_ID` and
 * `TURBOPACK` leak the same way. Drop them all so the child resolves its own
 * config, as it would from the user's shell.
 *
 * `NODE_ENV` is removed here rather than overwritten: a terminal should look
 * like the user's normal shell, where it's unset. The dev-server path pins it
 * to `development` itself ({@link devServerEnv}).
 */
export function hostChildEnv(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || isHostNextVar(name)) continue
    env[name] = value
  }
  return env
}

/**
 * {@link hostChildEnv} with `NODE_ENV=development`, for commands run in a
 * user's worktree (the dev server and its installs). Explicit `overrides` win,
 * so a caller can still set `NODE_ENV` on purpose.
 */
export function devServerEnv(
  overrides: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return { ...hostChildEnv(source), NODE_ENV: "development", ...overrides }
}

const HOST_NEXT_VARS = new Set(["NODE_ENV", "NEXT_DEPLOYMENT_ID", "TURBOPACK"])

function isHostNextVar(name: string): boolean {
  return name.startsWith("__NEXT_PRIVATE_") || HOST_NEXT_VARS.has(name)
}
