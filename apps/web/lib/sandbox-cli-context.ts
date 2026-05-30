"use server"

/**
 * Team + project slugs for the sandbox CLI, decoded from the project's OIDC
 * token. Used to build a `sandbox ssh --scope <team> --project <project> <name>`
 * string that resolves from anywhere. Returns {} if the token is missing or
 * malformed — the UI falls back to a bare `sandbox ssh <name>`.
 */
export async function getSandboxCliContext(): Promise<{ scope?: string; project?: string }> {
  const token = process.env.VERCEL_OIDC_TOKEN
  if (!token) return {}
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    )
    return {
      scope: typeof payload.owner === "string" ? payload.owner : undefined,
      project: typeof payload.project === "string" ? payload.project : undefined,
    }
  } catch {
    return {}
  }
}
