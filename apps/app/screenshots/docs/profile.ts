import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { resolveCaptureProfile, type CaptureProfile } from "../profile"
import { docsPreviews } from "./world"
import type { DemoPreview } from "./demo-site"

/** Port the docs build is served on, clear of the design-review harness's. */
const DEFAULT_DOCS_PORT = 3960

export interface DocsProfile {
  profile: CaptureProfile
  previews: DemoPreview[]
}

/**
 * The capture profile for the docs set: the harness's own profile under a
 * separate state dir and port — so a docs run never touches a design-review
 * world — plus a stand-in home directory.
 *
 * The stand-in home is there for Settings → Agent, which probes the host
 * live: it gets a `claude` on `PATH` and a signed-in `~/.claude.json`, so the
 * docs show Claude Code set up regardless of what the capturing machine has.
 */
export function resolveDocsProfile(): DocsProfile {
  process.env.SCREENSHOTS_STATE_DIR ??= join(
    resolveCaptureProfile().stateRoot,
    "docs"
  )
  process.env.SCREENSHOTS_PORT ??= String(DEFAULT_DOCS_PORT)
  const profile = resolveCaptureProfile()

  const home = join(profile.stateRoot, "home")
  const bin = join(home, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "sam@northwind.dev" } })
  )
  writeFileSync(
    join(bin, "claude"),
    '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.0 (Claude Code)"\nexit 0\n'
  )
  chmodSync(join(bin, "claude"), 0o755)
  profile.env.HOME = home
  profile.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`

  // Previews take the ports after the app's, one per Workspace.
  return { profile, previews: docsPreviews(profile.previewPort) }
}
