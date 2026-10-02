"use client"

import { useEffect, useState } from "react"
import { getMockupRuntime } from "@/lib/mockup-runtime"

// Fetched once per session and shared by every Mockup on the canvas.
let runtime: string | null = null
let pending: Promise<string> | null = null

/**
 * The script a Mockup page runs ahead of its own (the DOM bridge and the knobs
 * runtime, `MOCKUP_RUNTIME_JS`), or null until it has arrived. A failed fetch
 * yields "", so the page still shows, without element targeting or knobs.
 */
export function useMockupRuntime(): string | null {
  const [value, setValue] = useState(runtime)
  useEffect(() => {
    if (runtime !== null) return
    pending ??= getMockupRuntime().catch(() => "")
    let live = true
    void pending.then((script) => {
      runtime = script
      if (live) setValue(script)
    })
    return () => {
      live = false
    }
  }, [])
  return value
}
