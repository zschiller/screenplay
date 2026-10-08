"use client"

import { useEffect, useState } from "react"
import { getMockupRuntime } from "@/lib/mockup-runtime"
import { withBasePath } from "@/lib/base-path"
import { type Viewing, useViewing } from "@/lib/viewer/context"

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
  // A viewer (#1932) can't call server actions: they read it under the
  // canvas link.
  const viewing = useViewing()
  useEffect(() => {
    if (runtime !== null) return
    pending ??= (viewing ? fetchForViewer(viewing) : getMockupRuntime()).catch(
      () => ""
    )
    let live = true
    void pending.then((script) => {
      runtime = script
      if (live) setValue(script)
    })
    return () => {
      live = false
    }
  }, [viewing])
  return value
}

async function fetchForViewer(viewing: Viewing): Promise<string> {
  const res = await fetch(
    withBasePath(
      `/s/${encodeURIComponent(viewing.roomId)}/${viewing.shareKey}/mockup-runtime`
    )
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}
