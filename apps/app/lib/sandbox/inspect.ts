"use server"

import { isSandboxRunning } from "@/lib/sandbox"
import { sandboxLogPath } from "@/lib/sandbox/provision-internals"
import { runSandboxAction, step } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"

/**
 * Read the dev server log file from the sandbox. Returns the last N lines so
 * the response stays bounded even for long-running servers.
 */
export async function getSandboxLogs(
  sandboxName: string,
  maxLines: number = 1000
): Promise<SandboxActionResult<string>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    if (!isSandboxRunning(sandbox)) return ""
    const result = await step(sandbox, "sh", [
      "-c",
      `tail -n ${maxLines} ${sandboxLogPath(sandbox.name)} 2>/dev/null || true`,
    ])
    return result.stdout()
  })
}

/**
 * Discover routes by listing the project files and asking the LLM to identify
 * them. Best-effort: the caller decides what to do when discovery fails.
 */
export async function crawlRoutes(
  sandboxName: string
): Promise<SandboxActionResult<{ route: string; label: string }[]>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    // Get a broad file listing for the LLM to analyze
    const result = await step(sandbox, "find", [
      ".",
      "-maxdepth",
      "5",
      "-type",
      "f",
      "!",
      "-path",
      "*/node_modules/*",
      "!",
      "-path",
      "*/.git/*",
      "!",
      "-path",
      "*/.next/*",
      "!",
      "-path",
      "*/dist/*",
      "!",
      "-path",
      "*/.nuxt/*",
    ])
    const fileList = (await result.stdout()).trim()
    if (!fileList) return [{ route: "/", label: "Home" }]

    const { generateText } = await import("ai")
    const { resolveLanguageModel, DEFAULT_MODEL } =
      await import("@/lib/agent/providers")

    const res = await generateText({
      model: resolveLanguageModel(DEFAULT_MODEL),
      system: `You are analyzing a web project's file structure to discover its navigable routes.
Look at the file listing and determine the framework (Next.js, SvelteKit, Nuxt, Remix, React Router, Astro, plain React, etc.) and identify all static, user-facing routes.

Rules:
- Only return concrete, navigable routes (no dynamic segments like [id] or :id)
- Always include "/" if there's a home/index page
- Return ONLY a JSON array of objects with "route" and "label" keys, nothing else
- "label" should be a human-readable sentence case title for the route (e.g. "Home", "About us", "Blog posts")
- Example: [{"route": "/", "label": "Home"}, {"route": "/about", "label": "About"}, {"route": "/pricing", "label": "Pricing"}]
- If you can't determine routes, return [{"route": "/", "label": "Home"}]`,
      prompt: `Here are the project files:\n\n${fileList}`,
    })

    // Extract JSON array from response (handle markdown fences)
    const match = res.text.trim().match(/\[[\s\S]*\]/)
    const parsed: { route: string; label: string }[] = match
      ? JSON.parse(match[0])
      : [{ route: "/", label: "Home" }]

    return parsed
  })
}
