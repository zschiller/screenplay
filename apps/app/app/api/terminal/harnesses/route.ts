import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-helpers"
import {
  filterByCapability,
  harnessAvailability,
} from "@/lib/agent/harnesses/availability"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The harnesses this deployment can launch in a terminal tab, surfaced as
 * `{ key, label }` for the new-tab harness picker (#290) — now read through the
 * backend-aware **Harness Availability** seam (#476) rather than the selection
 * fold directly. On the hosted backend the seam folds the same
 * `SANDBOX_HARNESSES ∩ broker-egress`, so the picker shows exactly what it did
 * before; on the desktop backend it lists CLIs detected on the host. The
 * terminal surface needs only presence, so it filters on the `"terminal"`
 * capability (every available harness, none dropped for lacking an ACP adapter).
 *
 * The list is deployment-wide (env + provider config / host detection), not
 * per-sandbox, so this needs no room/session/sandbox — only an authenticated
 * session. The heavier `POST /api/terminal/url` (which gates on room membership
 * and boots the ttyd daemon) also returns this list when actually opening a tab;
 * this endpoint lets the tab strip draw the menu without those side effects.
 */
export async function GET() {
  const session = await getCurrentSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const available = filterByCapability(
    await harnessAvailability.list(),
    "terminal"
  )
  const harnesses = available.map(({ harness }) => ({
    key: harness.key,
    label: harness.label,
  }))

  return NextResponse.json({ harnesses }, { status: 200 })
}
