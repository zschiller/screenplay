"use server"

/**
 * The script every Mockup page runs ahead of its own (`MOCKUP_RUNTIME_JS`): the
 * frames' DOM bridge plus the knobs runtime. It lives in files only the server
 * reads, so the canvas asks for it once per session.
 */
export async function getMockupRuntime(): Promise<string> {
  const { MOCKUP_RUNTIME_JS } = await import("@/lib/sandbox-bridge")
  return MOCKUP_RUNTIME_JS
}
