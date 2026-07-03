/**
 * The one-session install-then-sign-in chain (ADR 0015). Pure — it wraps an
 * install command and a sign-in argv into a single `sh -c` the inline setup
 * terminal runs, so the install and the CLI's own login share one visible PTY.
 *
 * Chained with `&&`, so a failed install stops before the sign-in with its error
 * still on screen (the setup row then re-detects back to "Not installed"). This
 * is the tool-agnostic core `buildGhInstallAndAuthArgv` and
 * `buildClaudeCodeInstallAndAuthArgv` both express: install first, auth only if
 * it succeeded.
 */
export function chainInstallThenAuth(
  install: string,
  authArgv: string[]
): string[] {
  return ["sh", "-c", `${install} && ${authArgv.join(" ")}`]
}
