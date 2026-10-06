"use client"

import { useEffect, useState } from "react"

/** Milliseconds since `key` last changed, ticking once a second. */
export function useElapsed(key: string): number {
  const [now, setNow] = useState(() => Date.now())
  const [start, setStart] = useState(() => ({ key, at: now }))
  if (start.key !== key) setStart({ key, at: now })
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now - start.at
}
