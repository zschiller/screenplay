"use client"

import { useEffect, useRef, useState } from "react"
import "@xterm/xterm/css/xterm.css"
import "./terminal-tab.css"
import {
  decodeServerMessage,
  encodeHandshake,
  encodeInput,
  encodeResize,
  terminalWebSocketUrl,
  TTYD_SUBPROTOCOL,
} from "@/lib/terminal/ttyd-protocol"

/**
 * The hardened xterm + ttyd-wire-protocol terminal pane, extracted out of
 * `TerminalTab` so two thin wrappers can share one battle-tested core (ADR 0014):
 * the in-sandbox Branch terminal and the desktop host-session terminal Settings
 * mounts for `gh auth login`. Every xterm quirk this file works around — the
 * async-font measurement race, the WebKit stale-glyph-width poison, the
 * FitAddon scrollbar-reserve and hidden-pane guards — is fixed once here rather
 * than duplicated per mount.
 *
 * The core is transport-shaped, not sandbox-shaped: the caller supplies a
 * {@link PaneConnection} resolver (the WS endpoint + handshake token + ordered
 * `?arg=` list) and a `connectKey`; the hook owns the whole boot → connect →
 * stream → teardown lifecycle and reports a small {@link PaneState}. It knows
 * nothing about rooms, membership, or `$HOME` — those live in the wrappers.
 *
 * It is **not** a Chat Session: nothing here is written to the chat-store,
 * Postgres, or the Y.Doc; the scrollback lives only in the running PTY/daemon.
 */

/** What the wrapper resolves for a connection, or why it can't. */
export type PaneConnection =
  | {
      ok: true
      /** The daemon/server HTTP(S) origin the WS is derived from. */
      url: string
      /** Handshake auth token (`""` when the transport runs ungated). */
      token: string
      /** Ordered ttyd `?arg=` list — the session key followed by any launch argv. */
      args: string[]
    }
  | { ok: false; message: string }

/** The pane's connection lifecycle, for the wrapper's overlay. */
export type PaneState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }

export interface UseTerminalPaneOptions {
  /**
   * Re-establish the connection whenever this changes. `null` stays idle — no
   * socket opens and the wrapper renders its own overlay (e.g. "waiting for the
   * sandbox"). Fold every value the resolver depends on into the string so a
   * meaningful change reconnects, the way an effect dependency list would.
   */
  connectKey: string | null
  /**
   * Resolve the WS endpoint + handshake token + `?arg=` list. Read through a
   * ref, so its identity need not be stable — only `connectKey` drives
   * reconnection.
   */
  resolve: () => Promise<PaneConnection>
  /**
   * Fired once when a **live** session's socket closes — a PTY exit. The
   * host-session terminal uses this as its completion signal to re-detect. Not
   * fired on a resolve/connect failure or on unmount.
   */
  onExit?: () => void
  /** Overlay copy shown when a ready session's socket closes. Defaults to the
   *  Branch terminal's wording. */
  endedMessage?: string
}

/**
 * Normalize any CSS color string (incl. `oklch(...)` from the theme tokens) to a
 * form xterm's color parser understands, by round-tripping it through a canvas
 * fill — the browser resolves it to a hex/rgba string.
 */
function resolveColor(value: string, fallback: string): string {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return fallback
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  return ctx.fillStyle
}

/**
 * Resolve a CSS system-color keyword (e.g. `Highlight`, `HighlightText`) to a
 * concrete `rgb(...)` string. These keywords map to the OS's real selection
 * colors and track light/dark mode and the user's accent — so we get the
 * genuine system selection rather than a hand-picked approximation. The keyword
 * has to be resolved on an element that's actually in the document; a detached
 * node yields an empty/unresolved value, so we attach a hidden probe briefly.
 */
function systemColor(keyword: string, fallback: string): string {
  const probe = document.createElement("span")
  probe.style.color = keyword
  probe.style.display = "none"
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || fallback
}

export function useTerminalPane({
  connectKey,
  resolve,
  onExit,
  endedMessage,
}: UseTerminalPaneOptions): {
  hostRef: React.RefObject<HTMLDivElement | null>
  state: PaneState
} {
  const [state, setState] = useState<PaneState>({ status: "loading" })
  const hostRef = useRef<HTMLDivElement>(null)

  // The resolver / callbacks are read through refs so a wrapper can pass fresh
  // closures every render without forcing a reconnect — only `connectKey` does.
  // Synced in an effect (not during render) so a stale closure is never captured,
  // and always before the connect effect below reads them (it runs later, and
  // its resolver read is async).
  const resolveRef = useRef(resolve)
  const onExitRef = useRef(onExit)
  const endedRef = useRef(endedMessage)
  useEffect(() => {
    resolveRef.current = resolve
    onExitRef.current = onExit
    endedRef.current = endedMessage
  })

  useEffect(() => {
    if (connectKey === null) return
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let cleanup: (() => void) | undefined
    let sessionReady = false
    setState({ status: "loading" })
    ;(async () => {
      // 1. Resolve the endpoint + handshake token + arg list from the wrapper —
      //    the seam that carries whatever gating (or none) the transport needs.
      const conn = await resolveRef.current()
      if (cancelled) return
      if (!conn.ok) {
        setState({ status: "error", message: conn.message })
        return
      }
      const { url, token, args } = conn

      // 2. Boot xterm. Dynamic-import so the DOM-dependent module never loads
      //    during SSR.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])
      if (cancelled) return

      // Match the app's theme + monospace font so the terminal reads as native
      // chrome rather than a foreign embedded page.
      const styles = getComputedStyle(host)
      // `next/font` resolves `--font-mono` to a two-font list — the real Geist
      // face plus a *proportional* `size-adjust`ed system fallback that is NOT
      // monospace. Take only the real Geist face (the first token) and append
      // genuine monospace generics, so any glyph Geist can't supply still falls
      // back to a fixed-width font rather than that proportional fallback.
      const monoFamily = styles
        .getPropertyValue("--font-mono")
        .split(",")[0]
        ?.trim()
      const fontFamily = [
        monoFamily,
        "ui-monospace",
        "'SF Mono'",
        "Menlo",
        "monospace",
      ]
        .filter(Boolean)
        .join(", ")
      const fontSize = 13
      // The concrete primary face we wait on and later re-measure against —
      // Geist Mono when the theme resolved `--font-mono`, else the first
      // monospace fallback.
      const primaryFamily = fontFamily.split(",")[0]?.trim()

      // Geist Mono is loaded asynchronously (`next/font`, `font-display: swap`).
      // xterm measures the character cell exactly once, at `open()`, and never
      // re-measures — so if the font isn't ready yet it locks in the fallback's
      // metrics. That single wrong measurement skews every monospace assumption:
      // ASCII art / box-drawing stops aligning, substituted glyphs overflow
      // their cell, and `fit()` derives the wrong rows so the viewport spuriously
      // scrolls. Wait for the actual font before opening so we measure for real.
      try {
        if (primaryFamily)
          await document.fonts.load(`${fontSize}px ${primaryFamily}`)
        await document.fonts.ready
      } catch {
        // Font Loading API unavailable or rejected — fall through and open
        // anyway; worst case we're back to the previous (fallback-metric)
        // behavior rather than a dead terminal.
      }
      if (cancelled) return

      // Use the OS's real selection background via the CSS system-color keyword
      // `Highlight`. Unlike a hard-coded hex, it tracks light/dark mode and the
      // user's accent color, so the selection matches native chrome in either
      // theme. We deliberately leave `selectionForeground` unset so selected
      // glyphs keep their original (ANSI/foreground) color rather than being
      // recolored — matching how a native terminal highlights text. (Theme
      // tokens like `--primary` were no good here: they're authored as
      // `oklch(...)`, which the canvas/regex resolve pipeline can't normalize.)
      const foreground = resolveColor(styles.color, "#ffffff")
      const term = new Terminal({
        cursorBlink: true,
        fontFamily,
        fontSize,
        theme: {
          background: resolveColor(styles.backgroundColor, "#000000"),
          foreground,
          cursor: foreground,
          selectionBackground: systemColor("Highlight", "#b3d7ff"),
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      // Reclaim FitAddon's horizontal scrollbar reserve. Its width budget is
      // `parentWidth − element padding − (overviewRuler?.width || 14)` — 14px
      // held for a native scrollbar this terminal doesn't show (terminal-tab.css
      // hides it; xterm v6's own slider is an overlay that reserves nothing).
      // Before the padding moved onto `term.element`, that phantom reserve was
      // coincidentally cancelled by FitAddon over-reading the host's border-box
      // width; with the padding now visible to it, the reserve became a real
      // ~2-column dead gutter on the right. Recompute cols against the actual
      // content width: host width minus the 16px horizontal padding below.
      // (Same private `_core` dimensions FitAddon itself reads; verified in
      // Chromium + WebKit to restore the pre-padding column fill exactly.)
      const proposeDimensions = fit.proposeDimensions.bind(fit)
      fit.proposeDimensions = () => {
        const d = proposeDimensions()
        if (!d) return d
        const cell = (
          term as unknown as {
            _core?: {
              _renderService?: {
                dimensions?: { css?: { cell?: { width?: number } } }
              }
            }
          }
        )._core?._renderService?.dimensions?.css?.cell
        const w = parseInt(getComputedStyle(host).width)
        if (cell?.width && cell.width > 0 && !isNaN(w)) {
          d.cols = Math.max(2, Math.floor((w - 16) / cell.width))
        }
        return d
      }
      term.open(host)

      // Disable font shaping. Geist Mono ships programming ligatures (`liga`/
      // `calt` for `--`, `->`, `..`, `...`, etc.) and standard ligatures are ON
      // by default in CSS. xterm's DOM renderer merges a run of same-styled
      // cells into a single span, so the browser shapes the whole run and those
      // ligatures fire — collapsing N glyphs into fewer, which xterm then
      // spreads across the N reserved monospace cells. The visible result is
      // runs of `.` and `-` rendering with gaps ("wide" punctuation). Forcing
      // 1:1 glyph rendering on the xterm root (it cascades to the rows) keeps
      // every cell fixed-width. Must live on `term.element`, which only exists
      // after `open()`.
      const el = term.element
      if (el) {
        el.style.fontVariantLigatures = "none"
        el.style.fontFeatureSettings = '"liga" 0, "calt" 0, "dlig" 0'
        // The terminal's inset. This must live on `term.element`, NOT the host:
        // FitAddon sizes against `getComputedStyle(parent).height` — which both
        // engines report as the BORDER-box height for the absolutely-positioned
        // host — and subtracts only `term.element`'s own padding. Padding on the
        // host is therefore invisible to fit(): whether the bottom row clears it
        // becomes a pixel-remainder lottery on the pane height, and losing it
        // clips the terminal's last line (where a TUI paints its input box).
        // Here FitAddon subtracts it explicitly, so the geometry is correct at
        // every pane height. (4px 8px = the py-1/px-2 this replaces.)
        el.style.padding = "4px 8px"
      }

      // Fit the terminal to the pane — but only when it's actually visible AND
      // xterm has a real character-cell measurement to fit against.
      //
      // Terminal tabs are force-mounted and merely hidden with `display:none`
      // when inactive, so a tab switch collapses the host to zero size and fires
      // the ResizeObserver below. Two failure modes have to be avoided:
      //
      //  - Fitting while hidden: at 0 width FitAddon proposes a 1-column
      //    geometry and ships `encodeResize(1, …)` to the real PTY, reflowing
      //    tmux's scrollback to a single column — which survives the switch
      //    back. `offsetParent` is null precisely when an ancestor is
      //    `display:none`, so the guard skips that case.
      //
      //  - Fitting before xterm re-measures: a terminal `open()`ed while hidden
      //    measures its cell as 0×0 and pauses rendering. xterm only re-measures
      //    when *its own* IntersectionObserver reports the pane visible — and per
      //    the HTML rendering steps that lands *after* the ResizeObserver tick
      //    that detects the reveal. So a synchronous `fit()` right after a tab
      //    switch still reads a 0-width cell; FitAddon's `proposeDimensions()`
      //    bails and the terminal is stranded at its default 80×24, overflowing
      //    the pane with a scrollbar that scrolls only dead space. Polling
      //    `proposeDimensions()` across frames waits out that race without
      //    depending on observer ordering, then fits once metrics are real.
      let fitFrame = 0
      const fitWhenReady = (attempt = 0) => {
        cancelAnimationFrame(fitFrame)
        if (cancelled) return
        if (
          !host.offsetParent ||
          host.clientWidth === 0 ||
          host.clientHeight === 0
        )
          return
        if (fit.proposeDimensions()) {
          fit.fit()
          return
        }
        // Visible but xterm hasn't re-measured yet — retry next frame, capped so
        // a never-measuring terminal can't spin forever.
        if (attempt < 30) {
          fitFrame = requestAnimationFrame(() => fitWhenReady(attempt + 1))
        }
      }
      const safeFit = () => fitWhenReady()
      safeFit()

      // WebKit-only glyph-width poison (the "first terminal has wrong character
      // widths forever" bug — reproduced and verified against a live `claude`
      // TUI in Playwright WebKit; Chromium is unaffected).
      //
      // Mechanism: xterm's DOM renderer measures each glyph once (WidthCache)
      // and pads it with `letter-spacing = cellWidth − measuredWidth`. In
      // WebKit, a freshly created measure container can resolve the font list
      // to an *interim* font for its first layout passes — even when
      // `document.fonts` reports the webfont loaded — so glyphs measured during
      // the terminal's very first frames (Claude Code's TUI draws its `─` box
      // rules in the first PTY chunk) get a stale width. The cache never
      // invalidates, so those glyphs render squeezed/widened for the terminal's
      // entire life. Later terminals measure after WebKit's cascade settled, so
      // only the first one is wrong. Nothing font-loading-API-based can see
      // this (`fonts.check/load/ready` all report loaded the whole time).
      //
      // Detection reads ground truth from the rendered rows instead: for every
      // span, `rect.width / textLength` must equal the cell width — xterm's
      // letter-spacing correction guarantees that when the cached measurement
      // matches the rendered glyph, even for genuine fallback-font glyphs. A
      // span deviating >2% from the median means its cached width is stale.
      // The cure: set `fontFamily` to an equivalent-but-distinct string (the
      // option setter no-ops on `===`), which clears the WidthCache and
      // re-measures the cell. Budgeted so a pathological page can't nudge-loop.
      let fontNudged = false
      let nudgeBudget = 4
      const scanForStaleGlyphWidths = () => {
        if (cancelled || nudgeBudget <= 0) return
        // Hidden pane: no painted rows to scan (and a nudge would measure a
        // 0-width cell). The ResizeObserver re-scans on reveal.
        if (
          !host.offsetParent ||
          host.clientWidth === 0 ||
          host.clientHeight === 0
        )
          return
        const rowsEl = host.querySelector(".xterm-rows")
        if (!rowsEl) return
        const perChar: number[] = []
        for (const row of rowsEl.children) {
          for (const s of row.querySelectorAll("span")) {
            const len = (s.textContent ?? "").length
            if (len < 2) continue
            const w = s.getBoundingClientRect().width
            if (w > 0) perChar.push(w / len)
          }
        }
        if (perChar.length < 3) return
        perChar.sort((a, b) => a - b)
        const cell = perChar[Math.floor(perChar.length / 2)]!
        const stale = perChar.some((w) => Math.abs(w - cell) > cell * 0.02)
        if (!stale) return
        nudgeBudget--
        try {
          fontNudged = !fontNudged
          term.options.fontFamily = fontNudged
            ? `${fontFamily}, monospace`
            : fontFamily
          safeFit()
        } catch {
          // Terminal may already be disposed; ignore.
        }
      }
      // The poison forms while the renderer is young (first paints after
      // open()); scan through that window, then stand down.
      const glyphScanPoll = setInterval(scanForStaleGlyphWidths, 600)
      const glyphScanStop = setTimeout(
        () => clearInterval(glyphScanPoll),
        60_000
      )
      // Reveal-after-hidden paints fresh rows through the same young-renderer
      // path; scan shortly after each reveal too (post-render).
      let revealScan1 = 0
      let revealScan2 = 0
      const scheduleRevealScans = () => {
        clearTimeout(revealScan1)
        clearTimeout(revealScan2)
        revealScan1 = window.setTimeout(scanForStaleGlyphWidths, 600)
        revealScan2 = window.setTimeout(scanForStaleGlyphWidths, 1800)
      }

      // Native copy: with a selection, Cmd/Ctrl+C copies to the clipboard rather
      // than sending an interrupt; paste rides xterm's own textarea handling.
      term.attachCustomKeyEventHandler((e) => {
        if (
          e.type === "keydown" &&
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "c" &&
          term.hasSelection()
        ) {
          void navigator.clipboard?.writeText(term.getSelection())
          return false
        }
        return true
      })

      // 3. Connect straight to the daemon/server WebSocket and speak ttyd's wire
      //    protocol. The session key + launch argv the wrapper resolved ride
      //    along as the `?arg=`s: a fresh session lands straight in the command,
      //    a reconnect re-attaches to the still-live PTY.
      const ws = new WebSocket(terminalWebSocketUrl(url, args), [
        TTYD_SUBPROTOCOL,
      ])
      ws.binaryType = "arraybuffer"

      ws.onopen = () => {
        // The handshake is the first frame the server waits for before spawning
        // the PTY; it carries the fitted geometry so output isn't clipped.
        ws.send(
          encodeHandshake({
            authToken: token,
            columns: term.cols,
            rows: term.rows,
          })
        )
        if (!cancelled) {
          sessionReady = true
          setState({ status: "ready" })
        }
        term.focus()
      }
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        const msg = decodeServerMessage(new Uint8Array(ev.data))
        if (msg.type === "output") term.write(msg.data)
      }
      ws.onerror = () => {
        if (!cancelled) {
          setState({
            status: "error",
            message: "Lost connection to the terminal.",
          })
        }
      }
      ws.onclose = () => {
        if (cancelled) return
        // A close after we went ready is the PTY exiting (the local server
        // closes the socket on exit). That's the completion signal the
        // host-session terminal re-detects on; the Branch terminal has no
        // handler and just shows the ended overlay.
        if (sessionReady) onExitRef.current?.()
        setState((prev) =>
          prev.status === "ready"
            ? {
                status: "error",
                message: endedRef.current ?? "Terminal session ended.",
              }
            : prev
        )
      }

      const dataSub = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput(data))
      })
      // Propagate resizes to the real PTY. `fit()` adjusts cols/rows, which fires
      // onResize; pre-open resizes are folded into the handshake geometry above.
      const resizeSub = term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows))
      })
      const observer = new ResizeObserver(() => {
        try {
          safeFit()
          scheduleRevealScans()
        } catch {
          // The pane can be momentarily zero-sized (tab switch); ignore.
        }
      })
      observer.observe(host)

      cleanup = () => {
        cancelAnimationFrame(fitFrame)
        clearInterval(glyphScanPoll)
        clearTimeout(glyphScanStop)
        clearTimeout(revealScan1)
        clearTimeout(revealScan2)
        observer.disconnect()
        dataSub.dispose()
        resizeSub.dispose()
        ws.onclose = null
        ws.close()
        term.dispose()
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [connectKey])

  return { hostRef, state }
}
