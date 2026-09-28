import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { deriveFallbackName } from "@/lib/agent/fallback-name"
import { runOneShotModel } from "@/lib/agent/one-shot-model"
import { openRoomForRoute } from "@/lib/room-access"

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

/**
 * Name one prompt: try the model through {@link runOneShotModel} (hosted API-key
 * provider, or desktop `claude -p` via the host-model seam — #674), then parse
 * its two-line output. On no model / a failed call the transport returns `null`
 * and we fall back to the improved deterministic slug (#675). `deps` is injected
 * for tests; production uses the real per-backend transport.
 */
export async function generateOne(
  prompt: string,
  deps: { runModel?: typeof runOneShotModel } = {}
): Promise<NameResult> {
  const runModel = deps.runModel ?? runOneShotModel
  const fallback = deriveFallbackName(prompt)
  const raw = await runModel({ system: NAMING_SYSTEM_PROMPT, prompt })
  if (raw === null) return { branch: fallback.branch, label: fallback.label }

  const lines = raw
    .split("\n")
    .map((l: string) =>
      l
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/^[-*\d.)\s]+/, "")
        .trim()
    )
    .filter(Boolean)
  const branchRaw = sanitizeBranch(lines[0] ?? "")
  const labelRaw = (lines[1] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
  const branch =
    branchRaw.length >= 3 && branchRaw.length <= 50
      ? branchRaw
      : fallback.branch
  const label =
    labelRaw.length >= 2 && labelRaw.length <= 60 ? labelRaw : fallback.label
  return { branch, label }
}

async function branchExistsOnGitHub(
  repoOwner: string,
  repoName: string,
  branch: string,
  token: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    )
    if (res.status === 404) return false
    return res.ok
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as RequestBody
  const { roomId, prompts } = body
  if (!roomId || !Array.isArray(prompts) || prompts.length === 0) {
    return new Response("Missing required fields", { status: 400 })
  }

  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room
  const { userId } = room

  const generated = await Promise.all(prompts.map((p) => generateOne(p.trim())))

  const repo = await room
    .readDoc(({ repos }) => {
      const firstRepo = repos.toArray()[0]
      if (!firstRepo) return null
      return { repoOwner: firstRepo.repoOwner, repoName: firstRepo.repoName }
    })
    .catch(() => null)
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
      while (
        await branchExistsOnGitHub(
          repo.repoOwner,
          repo.repoName,
          candidate,
          token
        )
      ) {
        candidate = `${item.branch}-${suffix++}`
        if (suffix > 50) break
      }
    }
    taken.add(candidate)
    results.push({ branch: candidate, label: item.label })
  }

  return Response.json({ results })
}
