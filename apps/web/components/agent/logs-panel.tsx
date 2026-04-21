"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Anser from "anser"

const normalizeRgb = (rgb: string) => rgb.replace(/\s+/g, "")

const ANSI_FG_CLASS: Record<string, string> = {
  "0,0,0": "text-neutral-700 dark:text-neutral-300",
  "187,0,0": "text-red-600 dark:text-red-400",
  "0,187,0": "text-emerald-600 dark:text-emerald-400",
  "187,187,0": "text-amber-600 dark:text-amber-400",
  "0,0,187": "text-blue-600 dark:text-blue-400",
  "187,0,187": "text-fuchsia-600 dark:text-fuchsia-400",
  "0,187,187": "text-cyan-600 dark:text-cyan-400",
  "255,255,255": "text-foreground",
  "85,85,85": "text-neutral-500 dark:text-neutral-400",
  "255,85,85": "text-red-500 dark:text-red-300",
  "0,255,0": "text-emerald-500 dark:text-emerald-300",
  "255,255,85": "text-amber-500 dark:text-amber-300",
  "85,85,255": "text-blue-500 dark:text-blue-300",
  "255,85,255": "text-fuchsia-500 dark:text-fuchsia-300",
  "85,255,255": "text-cyan-500 dark:text-cyan-300",
}

const ANSI_BG_CLASS: Record<string, string> = {
  "187,0,0": "bg-red-500/15 dark:bg-red-400/15",
  "0,187,0": "bg-emerald-500/15 dark:bg-emerald-400/15",
  "187,187,0": "bg-amber-500/15 dark:bg-amber-400/15",
  "0,0,187": "bg-blue-500/15 dark:bg-blue-400/15",
  "187,0,187": "bg-fuchsia-500/15 dark:bg-fuchsia-400/15",
  "0,187,187": "bg-cyan-500/15 dark:bg-cyan-400/15",
  "255,85,85": "bg-red-500/15 dark:bg-red-400/15",
  "0,255,0": "bg-emerald-500/15 dark:bg-emerald-400/15",
  "255,255,85": "bg-amber-500/15 dark:bg-amber-400/15",
  "85,85,255": "bg-blue-500/15 dark:bg-blue-400/15",
  "255,85,255": "bg-fuchsia-500/15 dark:bg-fuchsia-400/15",
  "85,255,255": "bg-cyan-500/15 dark:bg-cyan-400/15",
}

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
            const classes: string[] = []
            if (t.fg) {
              const mapped = ANSI_FG_CLASS[normalizeRgb(t.fg)]
              if (mapped) classes.push(mapped)
              else style.color = `rgb(${t.fg})`
            }
            if (t.bg) {
              const mapped = ANSI_BG_CLASS[normalizeRgb(t.bg)]
              if (mapped) classes.push(mapped)
              else style.backgroundColor = `rgb(${t.bg})`
            }
            if (t.decorations.includes("bold")) style.fontWeight = 600
            if (t.decorations.includes("italic")) style.fontStyle = "italic"
            if (t.decorations.includes("underline")) style.textDecoration = "underline"
            if (t.decorations.includes("dim")) style.opacity = 0.7
            return (
              <span key={i} className={classes.join(" ") || undefined} style={style}>
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
