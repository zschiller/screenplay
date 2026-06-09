import { NextResponse } from "next/server"
import { isLocalBuild } from "@/lib/local-mode"

export const runtime = "nodejs"

/**
 * Native folder-picker bridge (PRD #428). The webview can't open OS dialogs
 * itself (the app talks to the sidecar over localhost HTTP, not Tauri IPC), so
 * this forwards to the Tauri shell's control server — the same channel the
 * thumbnail capturer uses — which opens a native directory dialog and returns
 * the chosen path. Outside the shell (sidecar driven from a browser during
 * development) there is no control server, so it reports `available: false`
 * and the picker falls back to a plain text path input (story 27).
 *
 * Response: `{ available: boolean, path?: string | null }` — `path` is `null`
 * when the user cancelled the dialog.
 */
export async function POST() {
  if (!isLocalBuild) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const controlUrl = process.env.TAURI_CONTROL_URL
  if (!controlUrl) {
    return NextResponse.json({ available: false })
  }
  try {
    const res = await fetch(`${controlUrl}/pick-directory`, { method: "POST" })
    if (!res.ok) return NextResponse.json({ available: false })
    const data = (await res.json()) as { path: string | null }
    return NextResponse.json({ available: true, path: data.path })
  } catch {
    return NextResponse.json({ available: false })
  }
}
