"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Anser from "anser"
import { withBasePath } from "@/lib/base-path"

const MAX_TOKENS = 10_000
const FLUSH_PENDING_MAX_BYTES = 64 * 1024

type Token = Anser.AnserJsonEntry & { _id: number }
let nextTokenId = 0

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

function renderToken(t: Token) {
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
    <span key={t._id} className={classes.join(" ") || undefined} style={style}>
      {t.content}
    </span>
  )
}

export function LogsPanel({
  sandboxName,
  onConnected,
}: {
  sandboxName: string
  onConnected?: () => void
}) {
  const pendingRef = useRef("")
  const rafRef = useRef<number | null>(null)
  const [tokens, setTokens] = useState<Token[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const onConnectedRef = useRef(onConnected)

  // Keep the latest onConnected callback in a ref (written after commit, not
  // during render) so the streaming loop always invokes the current handler.
  useEffect(() => {
    onConnectedRef.current = onConnected
  })

  const flush = useCallback(() => {
    rafRef.current = null
    const buf = pendingRef.current
    if (!buf) return
    // Split at the last newline so we never parse a partial ANSI escape sequence
    // straddling a chunk boundary. If we've buffered too much without a newline,
    // force a flush to keep the UI responsive.
    let splitAt = buf.lastIndexOf("\n")
    if (splitAt === -1) {
      if (buf.length < FLUSH_PENDING_MAX_BYTES) return
      splitAt = buf.length - 1
    }
    const toParse = buf.slice(0, splitAt + 1)
    pendingRef.current = buf.slice(splitAt + 1)
    const parsed = Anser.ansiToJson(toParse, { remove_empty: true, json: true })
    if (parsed.length === 0) return
    const tagged = parsed as Token[]
    for (const t of tagged) t._id = nextTokenId++
    setTokens((prev) => {
      const next = prev.concat(tagged)
      return next.length > MAX_TOKENS
        ? next.slice(next.length - MAX_TOKENS)
        : next
    })
  }, [])

  const schedule = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(flush)
  }, [flush])

  // Reset the rendered stream state synchronously during render whenever the
  // target sandbox changes, instead of in the streaming effect below — a
  // setState in the effect body would cascade an extra render. The effect still
  // owns the fetch/reconnect loop and updates `connected`/`error` from its
  // async callbacks (allowed) as the stream progresses.
  const [lastSandboxName, setLastSandboxName] = useState(sandboxName)
  if (sandboxName !== lastSandboxName) {
    setLastSandboxName(sandboxName)
    setTokens([])
    setError(null)
    setConnected(false)
  }

  useEffect(() => {
    const abort = new AbortController()
    pendingRef.current = ""
    let seenNonWhitespace = false
    let isReconnect = false

    const runOnce = async () => {
      const url = withBasePath(
        `/api/sandbox/${encodeURIComponent(sandboxName)}/logs${isReconnect ? "?followOnly=1" : ""}`
      )
      const res = await fetch(url, { signal: abort.signal, cache: "no-store" })
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }
      setConnected(true)
      setError(null)
      if (!isReconnect) onConnectedRef.current?.()
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
        pendingRef.current += chunk
        schedule()
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
    return () => {
      abort.abort()
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [sandboxName, schedule])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [tokens])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 20
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80"
      >
        {error ? (
          <span className="text-red-600 dark:text-red-400">
            Failed to stream logs: {error}
          </span>
        ) : tokens.length > 0 ? (
          tokens.map(renderToken)
        ) : (
          <span className="text-muted-foreground">
            {connected ? "No output yet." : "Connecting…"}
          </span>
        )}
      </div>
    </div>
  )
}
