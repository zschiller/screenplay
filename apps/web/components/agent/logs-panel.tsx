"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Anser from "anser"

export function LogsPanel({ sandboxName }: { sandboxName: string }) {
  const [content, setContent] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const abort = new AbortController()
    setContent("")
    setError(null)
    setConnected(false)
    let seenNonWhitespace = false
    let isReconnect = false

    const runOnce = async () => {
      const url = `/api/sandbox/${encodeURIComponent(sandboxName)}/logs${isReconnect ? "?followOnly=1" : ""}`
      const res = await fetch(url, { signal: abort.signal, cache: "no-store" })
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }
      setConnected(true)
      setError(null)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        let chunk = decoder.decode(value, { stream: true })
        if (!seenNonWhitespace) {
          chunk = chunk.replace(/^\s+/, "")
          if (chunk.length > 0) seenNonWhitespace = true
          else continue
        }
        setContent((prev) => prev + chunk)
      }
    }

    const loop = async () => {
      while (!abort.signal.aborted) {
        try {
          await runOnce()
          isReconnect = true
        } catch (e) {
          if ((e as Error).name === "AbortError") return
          setConnected(false)
          setError(e instanceof Error ? e.message : String(e))
        }
        if (abort.signal.aborted) return
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    loop()
    return () => abort.abort()
  }, [sandboxName])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [content])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 20
  }

  const tokens = useMemo(
    () => (content ? Anser.ansiToJson(content, { remove_empty: true, json: true }) : []),
    [content],
  )

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80"
      >
        {error ? (
          <span className="text-red-600 dark:text-red-400">
            Failed to stream logs: {error}
          </span>
        ) : tokens.length > 0 ? (
          tokens.map((t, i) => {
            const style: React.CSSProperties = {}
            if (t.fg) style.color = `rgb(${t.fg})`
            if (t.bg) style.backgroundColor = `rgb(${t.bg})`
            if (t.decorations.includes("bold")) style.fontWeight = 600
            if (t.decorations.includes("italic")) style.fontStyle = "italic"
            if (t.decorations.includes("underline")) style.textDecoration = "underline"
            if (t.decorations.includes("dim")) style.opacity = 0.7
            return (
              <span key={i} style={style}>
                {t.content}
              </span>
            )
          })
        ) : (
          <span className="text-muted-foreground">
            {connected ? "No output yet." : "Connecting…"}
          </span>
        )}
      </div>
    </div>
  )
}
