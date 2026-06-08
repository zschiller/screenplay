"use client"

import { useEffect, useState } from "react"
import { withBasePath } from "@/lib/base-path"

/** A harness the operator can launch a terminal tab into (key + display label). */
export type InstalledHarness = { key: string; label: string }

/**
 * Fetch the harnesses installed in this deployment's sandboxes for the new-tab
 * picker (#290). Deployment-wide (driven by `SANDBOX_HARNESSES` + configured
 * providers), so it's fetched once and never refetched — and only when
 * `enabled` (the panel is targeting an agent that can open terminals).
 *
 * Returns `[]` until the fetch resolves and on any failure: callers treat an
 * empty list as "fall back to the default harness", so a flaky fetch degrades
 * to the pre-picker behavior rather than blocking new-tab creation.
 */
export function useInstalledHarnesses(enabled: boolean): InstalledHarness[] {
  const [harnesses, setHarnesses] = useState<InstalledHarness[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(withBasePath("/api/terminal/harnesses"))
        if (!res.ok) return
        const body = (await res.json()) as { harnesses?: InstalledHarness[] }
        if (!cancelled && Array.isArray(body.harnesses)) {
          setHarnesses(body.harnesses)
        }
      } catch {
        // Leave the list empty — the caller falls back to the default harness.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return harnesses
}
