import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import { selectHarnesses } from "@/lib/agent/harnesses"
import { getModelProviders } from "@/lib/agent/providers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The harnesses installed in this deployment's sandboxes — the same selection
 * fold provisioning runs over `SANDBOX_HARNESSES` + the configured providers,
 * surfaced as `{ key, label }` for the new-tab harness picker (#290).
 *
 * The list is deployment-wide (env + provider config), not per-sandbox, so this
 * needs no room/session/sandbox — only an authenticated session. The heavier
 * `POST /api/terminal/url` (which gates on room membership and boots the ttyd
 * daemon) also returns this list when actually opening a tab; this endpoint lets
 * the tab strip draw the menu without those side effects.
 */
export async function GET() {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const installable = selectHarnesses(
    process.env.SANDBOX_HARNESSES,
    getModelProviders()
  ).installable
  const harnesses = installable.map((h) => ({ key: h.key, label: h.label }))

  return NextResponse.json({ harnesses }, { status: 200 })
}
