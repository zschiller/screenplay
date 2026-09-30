"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Anser from "anser"
import { ArrowCounterClockwiseIcon } from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { withBasePath } from "@/lib/base-path"
import {
  ANSI_PALETTE_CSS,
  ansiClassIndex,
  ansiColorVar,
  TERMINAL_FONT_SIZE,
  xterm256Rgb,
} from "@workspace/ui/lib/ansi-palette"

const MAX_TOKENS = 10_000
const FLUSH_PENDING_MAX_BYTES = 64 * 1024

type Token = Anser.AnserJsonEntry & { _id: number }
let nextTokenId = 0

/**
 * A token's colour as CSS. The base 16 (named, or a 256-colour index under 16)
 * resolve through the shared ANSI palette's CSS variables, so they follow the
 * theme; a higher 256-colour index or a truecolour carries its own RGB.
 */
function tokenColor(cls: string | null, truecolor: string | null) {
  if (!cls) return undefined
  if (cls === "ansi-truecolor") {
    return truecolor ? `rgb(${truecolor})` : undefined
  }
  const index = ansiClassIndex(cls)
  if (index !== null) return ansiColorVar(index)
  const palette = /^ansi-palette-(\d+)$/.exec(cls)
  if (palette) return `rgb(${xterm256Rgb(Number(palette[1])).join(",")})`
  return undefined
}

function renderToken(t: Token) {
  const style: React.CSSProperties = {}
  const fg = tokenColor(t.fg, t.fg_truecolor)
  if (fg) style.color = fg
  const bg = tokenColor(t.bg, t.bg_truecolor)
  // Backgrounds are a tint of the colour rather than a solid block, so the
  // (theme) foreground on top of them stays readable in either theme.
  if (bg) style.backgroundColor = `color-mix(in srgb, ${bg} 18%, transparent)`
  if (t.decorations.includes("bold")) style.fontWeight = 600
  if (t.decorations.includes("italic")) style.fontStyle = "italic"
  if (t.decorations.includes("underline")) style.textDecoration = "underline"
  if (t.decorations.includes("dim")) style.opacity = 0.7
  return (
    <span key={t._id} style={style}>
      {t.content}
    </span>
  )
}

/**
 * Where the log stream is:
 * - `connecting` — the first connection hasn't landed yet;
 * - `live` — streaming;
 * - `reconnecting` — the stream dropped (or ended) and is being re-opened;
 * - `error` — {@link ERROR_AFTER_FAILURES} attempts in a row failed. Retries
 *   carry on in the background at the slowest cadence; Retry skips the wait.
 */
type StreamStatus = "connecting" | "live" | "reconnecting" | "error"

/** Back-off between attempts, by consecutive failures (the last one repeats). */
const RETRY_DELAYS_MS = [1500, 3000, 6000, 15_000]
const ERROR_AFTER_FAILURES = 3

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
  const [status, setStatus] = useState<StreamStatus>("connecting")
  const [error, setError] = useState<string | null>(null)
  // Set while the loop is waiting out a back-off; calling it ends the wait now.
  const retryRef = useRef<(() => void) | null>(null)
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
    const parsed = Anser.ansiToJson(toParse, {
      remove_empty: true,
      json: true,
      // Class names (`ansi-red`, `ansi-bright-white`) rather than RGB: anser's
      // RGB gives white and bright white the same value, and the palette
      // needs to tell all 16 apart.
      use_classes: true,
    })
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
    setStatus("connecting")
  }

  useEffect(() => {
    const abort = new AbortController()
    pendingRef.current = ""
    let seenNonWhitespace = false
    let isReconnect = false
    let failures = 0

    const runOnce = async () => {
      const url = withBasePath(
        `/api/sandbox/${encodeURIComponent(sandboxName)}/logs${isReconnect ? "?followOnly=1" : ""}`
      )
      const res = await fetch(url, { signal: abort.signal, cache: "no-store" })
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }
      failures = 0
      setStatus("live")
      setError(null)
      if (!isReconnect) onConnectedRef.current?.()
      // From here on a drop is a *re*connect, and resumes from the live tail
      // rather than replaying the history already on screen.
      isReconnect = true
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

    // Wait out a back-off — cut short by Retry, or by teardown.
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          abort.signal.removeEventListener("abort", done)
          retryRef.current = null
          resolve()
        }
        const timer = setTimeout(done, ms)
        abort.signal.addEventListener("abort", done)
        retryRef.current = done
      })

    const loop = async () => {
      while (!abort.signal.aborted) {
        try {
          await runOnce()
          // The stream ended cleanly (the container restarted, the proxy
          // recycled the connection): pick it back up from the live tail.
          setStatus("reconnecting")
        } catch (e) {
          if ((e as Error).name === "AbortError") return
          failures++
          setError(e instanceof Error ? e.message : String(e))
          setStatus(
            failures >= ERROR_AFTER_FAILURES
              ? "error"
              : isReconnect
                ? "reconnecting"
                : "connecting"
          )
        }
        if (abort.signal.aborted) return
        // A clean end (no failures) retries as promptly as a first failure.
        const step = Math.max(failures - 1, 0)
        await wait(RETRY_DELAYS_MS[Math.min(step, RETRY_DELAYS_MS.length - 1)]!)
      }
    }

    loop()
    return () => {
      abort.abort()
      retryRef.current = null
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

  // Keep pinned to the bottom when the container's size changes — most
  // importantly when the tab transitions from hidden (display:none, where
  // scrollHeight is 0 so the effect above is a no-op) to visible. Without
  // this, opening the Logs tab after output has already streamed in leaves
  // the panel scrolled to the top instead of the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 20
  }

  const retry = () => {
    setStatus(tokens.length > 0 ? "reconnecting" : "connecting")
    retryRef.current?.()
  }

  const notice =
    status === "reconnecting" ? (
      <span className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
        <Spinner className="size-3" /> Reconnecting…
      </span>
    ) : status === "error" ? (
      // The UI's own words in its own font: mono is for the log lines. The
      // transport error ("HTTP 502") stays on hover.
      <span className="flex min-w-0 items-center gap-2 font-sans text-xs">
        <span
          className="min-w-0 truncate text-destructive"
          title={error ?? undefined}
        >
          Couldn&apos;t load the logs.
        </span>
        <Button
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={retry}
        >
          <ArrowCounterClockwiseIcon /> Retry
        </Button>
      </span>
    ) : null

  return (
    <div className="flex h-full flex-col bg-background">
      {/* The shared ANSI palette's CSS variables; React hoists and dedupes it. */}
      <style href="ansi-palette" precedence="default">
        {ANSI_PALETTE_CSS}
      </style>
      {/* Terminal metrics: xterm's 16px rows and 4px/12px inset at the shared
          font size (12px = the chat's `p-3` gutter), so switching tabs doesn't
          shift the text. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ fontSize: TERMINAL_FONT_SIZE }}
        className="flex-1 overflow-auto px-3 py-1 font-mono leading-4 whitespace-pre-wrap text-foreground/80"
      >
        {tokens.length > 0 ? (
          tokens.map(renderToken)
        ) : status === "error" || status === "reconnecting" ? (
          notice
        ) : (
          <span className="font-sans text-xs text-muted-foreground">
            {status === "live" ? "No output yet." : "Connecting…"}
          </span>
        )}
      </div>
      {tokens.length > 0 && notice && (
        // With history on screen the state rides a footer strip instead, so a
        // dropped stream never hides the output that was already there.
        <div
          role="status"
          className="flex shrink-0 items-center border-t px-3 py-1.5"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
