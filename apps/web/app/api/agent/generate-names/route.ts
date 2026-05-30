import { generateText } from "ai"
import { getGitHubTokenForUser, getUserId } from "@/lib/auth-helpers"
import { DEFAULT_MODEL, resolveLanguageModel } from "@/lib/agent/providers"
import { readRoomDoc } from "@/lib/yjs/server"

export const runtime = "nodejs"

interface RequestBody {
  roomId: string
  prompts: string[]
}

interface NameResult {
  branch: string
  label: string
}

const NAMING_SYSTEM_PROMPT =
  "Generate two things for the user's request:\n" +
  "1. A short, lowercase, hyphenated git branch name (2-4 words)\n" +
  "2. A short chat label (2-5 words, title case)\n\n" +
  "Output ONLY as two lines, no explanation, backticks, or quotes.\n" +
  "Line 1: branch name\nLine 2: chat label\n\n" +
  "Examples:\nfix-login-button\nFix Login Button\n\n" +
  "add-dark-mode\nAdd Dark Mode"

function sanitizeBranch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function deriveFallbackBranch(prompt: string): string {
  const slug = sanitizeBranch(prompt).slice(0, 30).replace(/-$/, "")
  if (slug.length >= 3) return slug
  return `agent-${Math.random().toString(36).slice(2, 8)}`
}

function deriveFallbackLabel(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim()
  if (!cleaned) return "Untitled"
  const words = cleaned.split(" ").slice(0, 6).join(" ")
  return words.length > 50 ? `${words.slice(0, 50).trimEnd()}…` : words
}

async function generateOne(prompt: string): Promise<NameResult> {
  try {
    const res = await generateText({
      model: resolveLanguageModel(DEFAULT_MODEL),
      system: NAMING_SYSTEM_PROMPT,
      prompt,
    })
    const lines = res.text
      .trim()
      .split("\n")
      .map((l: string) =>
        l.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^[-*\d.)\s]+/, "").trim(),
      )
      .filter(Boolean)
    const branchRaw = sanitizeBranch(lines[0] ?? "")
    const labelRaw = (lines[1] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
    const branch =
      branchRaw.length >= 3 && branchRaw.length <= 50
        ? branchRaw
        : deriveFallbackBranch(prompt)
    const label =
      labelRaw.length >= 2 && labelRaw.length <= 60 ? labelRaw : deriveFallbackLabel(prompt)
    return { branch, label }
  } catch (e) {
    console.error("Branch/chat name generation failed:", e)
    return { branch: deriveFallbackBranch(prompt), label: deriveFallbackLabel(prompt) }
  }
}

async function branchExistsOnGitHub(
  repoOwner: string,
  repoName: string,
  branch: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
    )
    if (res.status === 404) return false
    return res.ok
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body = (await req.json()) as RequestBody
  const { roomId, prompts } = body
  if (!roomId || !Array.isArray(prompts) || prompts.length === 0) {
    return new Response("Missing required fields", { status: 400 })
  }

  const generated = await Promise.all(prompts.map((p) => generateOne(p.trim())))

  const repo = await readRoomDoc(roomId, ({ repos }) => {
    const firstRepo = repos.toArray()[0]
    if (!firstRepo) return null
    return { repoOwner: firstRepo.repoOwner, repoName: firstRepo.repoName }
  }).catch(() => null)
  const token = await getGitHubTokenForUser(userId)

  const taken = new Set<string>()
  const results: NameResult[] = []
  for (const item of generated) {
    let candidate = item.branch
    let suffix = 2
    while (taken.has(candidate)) {
      candidate = `${item.branch}-${suffix++}`
      if (suffix > 50) break
    }
    if (repo && token) {
      while (await branchExistsOnGitHub(repo.repoOwner, repo.repoName, candidate, token)) {
        candidate = `${item.branch}-${suffix++}`
        if (suffix > 50) break
      }
    }
    taken.add(candidate)
    results.push({ branch: candidate, label: item.label })
  }

  return Response.json({ results })
}
