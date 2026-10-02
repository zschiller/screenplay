"use client"

import { useEffect, useRef } from "react"

import { createDitherVeil } from "./dither-veil"
import "./hero-stage.css"

const HEAD = "Every branch, side by side."
const HEADLINES = [
  "Every idea, side by side.",
  "Ship the version that works.",
  "Five branches. One canvas.",
  "See every branch, live.",
]

/** What an agent can do to a copy: its Workspace name, a class to add (or a
 * headline to type) and the diff it shows. `not` is an edit it can't combine
 * with. */
const EDITS: {
  ws: string
  cls?: string
  type?: true
  diff: [number, number]
  not?: string
}[] = [
  { ws: "New headline", type: true, diff: [1, 1] },
  { ws: "Tinted page", cls: "soft", diff: [3, 1] },
  { ws: "Centered hero", cls: "center", diff: [6, 2], not: "split" },
  { ws: "Split hero", cls: "split", diff: [9, 4], not: "center" },
  { ws: "Feature cards", cls: "cards", diff: [14, 3] },
  { ws: "Launch banner", cls: "banner", diff: [5, 0] },
  { ws: "Pill buttons", cls: "pill", diff: [2, 2] },
  { ws: "Mono headline", cls: "mono", diff: [3, 1], not: "sans" },
  { ws: "Bigger headline", cls: "big", diff: [1, 1] },
  { ws: "Accent button", cls: "accent-btn", diff: [2, 0] },
  { ws: "Sans headline", cls: "sans", diff: [4, 2], not: "mono" },
  { ws: "Blue accent", cls: "blue", diff: [1, 1] },
]

// What each copy has already done when the page loads, so the first frame
// shows variety. Index 0 is main, untouched.
const SEED = [[], [1, 4], [0], [2, 6], [7], [9, 6], [10, 1], [5, 8], [11, 3]]

const PAGE = `
  <div class="hc-page">
    <div class="hc-nav"><span class="hc-logo"><i></i>Screenplay</span><span class="hc-links"><span>How it works</span><span>Features</span><span>Docs</span></span><span class="hc-dl">Download</span></div>
    <div class="hc-hero">
      <div class="hc-h1">${HEAD}</div>
      <div class="hc-row"><p class="hc-lede">Run your coding agents on separate branches and see every result live on one canvas.</p><div class="hc-btns"><span class="hc-b solid">Download for Mac</span><span class="hc-b">Host it for your team</span></div></div>
      <div class="hc-fig"><span></span><span></span><span></span></div>
    </div>
  </div>`

// A Workspace's state, as in the app: a ring when it's ready, the twinkling
// 3×3 grid while its agent works.
const GLYPH = `<svg class="hc-glyph" viewBox="0 0 24 24"><circle class="hc-ring" cx="12" cy="12" r="8.5" /><g class="hc-grip">${[
  5, 12, 19,
]
  .flatMap((cy) => [5, 12, 19].map((cx) => [cx, cy]))
  .map(
    ([cx, cy], i) =>
      `<circle class="grip-dot" cx="${cx}" cy="${cy}" r="2" style="animation-delay:${-((i * 7) % 9) * 0.21}s" />`
  )
  .join("")}</g></svg>`

type Copy = {
  el: HTMLElement
  page: HTMLElement
  box: HTMLElement
  h1: HTMLElement
  name: HTMLElement
  diff: HTMLElement
  done: number[]
  busy: boolean
}

/**
 * The hero's backdrop: copies of this homepage pan past in two rows, each a
 * Workspace an agent is changing live, above the text.
 * The headline, marked `data-veil`, sinks into the bottom row, and a dither in
 * the page's own background colour thickens from the top of the rows, slowly
 * at first, to solid partway down the headline's first line, so the copies
 * dissolve into it and the text stays readable.
 *
 * The copies are built on the client only; they're decoration, hidden from
 * assistive tech. With reduced motion they hold still. Hovering clears a hole
 * in the veil to peek at them.
 */
export function HeroStage({ children }: { children: React.ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = stage.current!
    const rowsEl = strip.current!
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    // Clear at the top of the rows, solid most of the way down the headline's
    // first line, so that line sits on the densest grain.
    const veil = createDitherVeil(canvas.current!, () => {
      const s = host.getBoundingClientRect().top
      const head = host.querySelector<HTMLElement>("[data-veil]")!
      const size = parseFloat(getComputedStyle(head).fontSize)
      return [
        rowsEl.getBoundingClientRect().top - s,
        head.getBoundingClientRect().top - s + size * 0.88,
      ]
    })
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let alive = false
    let visibleNow = false
    let headlineIndex = 0
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t)
          resolve()
        }, ms)
        timers.add(t)
      })

    const label = (f: Copy) => {
      f.name.textContent = f.done.length ? EDITS[f.done[0]!]!.ws : "Main"
      const add = f.done.reduce((n, i) => n + EDITS[i]!.diff[0], 0)
      const del = f.done.reduce((n, i) => n + EDITS[i]!.diff[1], 0)
      f.diff.innerHTML = f.done.length
        ? `<span class="a">+${add}</span> <span class="d">-${del}</span>`
        : ""
    }
    const nextHeadline = () => HEADLINES[headlineIndex++ % HEADLINES.length]!

    // Two rows panning opposite ways; each holds two identical runs, so the
    // loop is seamless at -50%.
    const copies: Copy[] = []
    for (const seeds of [SEED, [...SEED.slice(4), ...SEED.slice(0, 4)]]) {
      const track = document.createElement("div")
      track.className = "hc-track"
      for (let rep = 0; rep < 2; rep++) {
        for (const seed of seeds) {
          const el = document.createElement("div")
          el.className = "hc-copy"
          el.innerHTML = `<div class="hc-head">${GLYPH}<span class="hc-name"></span><span class="hc-diff"></span></div><div class="hc-box">${PAGE}</div>`
          const f: Copy = {
            el,
            page: el.querySelector(".hc-page")!,
            box: el.querySelector(".hc-box")!,
            h1: el.querySelector(".hc-h1")!,
            name: el.querySelector(".hc-name")!,
            diff: el.querySelector(".hc-diff")!,
            done: [],
            busy: false,
          }
          for (const i of seed) {
            const e = EDITS[i]!
            if (e.type) f.h1.textContent = nextHeadline()
            else f.page.classList.add(e.cls!)
            f.done.push(i)
          }
          label(f)
          track.appendChild(el)
          copies.push(f)
        }
      }
      rowsEl.appendChild(track)
    }

    async function type(f: Copy, text: string) {
      let cur = f.h1.textContent ?? ""
      const caret = '<span class="hc-caret"></span>'
      while (cur.length && alive) {
        cur = cur.slice(0, -1)
        f.h1.innerHTML = cur + caret
        await wait(20)
      }
      for (const ch of text) {
        if (!alive) break
        cur += ch
        f.h1.innerHTML = cur + caret
        await wait(50)
      }
      f.h1.textContent = cur
    }

    // A few agents at once each keep picking a copy on screen and changing
    // it, or, after a few edits, wiping it back to main to start over.
    async function agent(delay: number) {
      await wait(delay)
      while (alive) {
        const s = rowsEl.getBoundingClientRect()
        const onScreen = copies.filter((f) => {
          const r = f.el.getBoundingClientRect()
          return !f.busy && r.left > s.left + 20 && r.right < s.right - 20
        })
        // Mostly the top row, which the veil leaves clearest.
        const clear = onScreen.filter((f) => rowsEl.firstChild!.contains(f.el))
        const pool = clear.length && Math.random() < 0.75 ? clear : onScreen
        const f = pool[Math.floor(Math.random() * pool.length)]
        if (f) await edit(f)
        await wait(500 + Math.random() * 700)
      }
    }
    async function edit(f: Copy) {
      f.busy = true
      f.el.classList.add("working")
      if (f.done.length >= 3) {
        f.box.classList.add("wipe")
        await wait(700)
        f.page.className = "hc-page"
        f.h1.textContent = HEAD
        f.done = []
        label(f)
        f.box.classList.remove("wipe")
        await wait(700)
      } else {
        const blocked = new Set(
          f.done.flatMap((i) => [EDITS[i]!.cls, EDITS[i]!.not])
        )
        const pool = EDITS.map((_, i) => i).filter(
          (i) => !f.done.includes(i) && !blocked.has(EDITS[i]!.cls)
        )
        const i = pool[Math.floor(Math.random() * pool.length)]!
        // The agent thinks for a moment, then the change lands.
        await wait(600)
        if (!alive) return
        f.done.push(i)
        label(f)
        const e = EDITS[i]!
        if (e.type) await type(f, nextHeadline())
        else {
          f.page.classList.add(e.cls!)
          await wait(900)
        }
      }
      f.el.classList.remove("working")
      f.busy = false
    }

    const play = () => {
      if (reduce || alive) return
      alive = true
      host.dataset.playing = ""
      veil.start()
      for (let k = 0; k < 3; k++) void agent(k * 450)
    }
    const pause = () => {
      alive = false
      delete host.dataset.playing
      veil.stop()
      timers.forEach(clearTimeout)
      timers.clear()
      copies.forEach((f) => {
        f.busy = false
        f.el.classList.remove("working")
      })
    }

    // At most once a frame, and drawn straight away, so dragging the window
    // neither stalls nor flashes an empty veil.
    let pending = 0
    const remeasure = () => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        veil.measure()
        veil.drawOnce()
        if (alive && !reduce) veil.start()
      })
    }
    veil.setColor(getComputedStyle(host).backgroundColor)
    remeasure()
    // Webfonts change where the lines fall.
    void document.fonts.ready.then(remeasure)

    // Hovering clears a hole in the veil to peek at the copies underneath.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return
      const r = host.getBoundingClientRect()
      veil.peekAt({ x: e.clientX - r.left, y: e.clientY - r.top })
      if (reduce) veil.drawOnce()
    }
    const onLeave = () => {
      veil.peekAt(null)
      if (reduce) veil.drawOnce()
    }
    host.addEventListener("pointermove", onMove)
    host.addEventListener("pointerleave", onLeave)

    const resize = new ResizeObserver(remeasure)
    resize.observe(host)
    // Only animate while the hero is on screen.
    const seen = new IntersectionObserver(([entry]) => {
      visibleNow = !!entry?.isIntersecting
      if (visibleNow) play()
      else pause()
    })
    seen.observe(host)

    return () => {
      pause()
      cancelAnimationFrame(pending)
      resize.disconnect()
      host.removeEventListener("pointermove", onMove)
      host.removeEventListener("pointerleave", onLeave)
      seen.disconnect()
      rowsEl.replaceChildren()
    }
  }, [])

  return (
    <div
      ref={stage}
      className="hc-stage relative isolate overflow-hidden bg-background"
    >
      <div aria-hidden className="hc-backdrop">
        <div ref={strip} className="hc-rows" />
      </div>
      <canvas
        ref={canvas}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] size-full"
      />
      <div className="hc-content relative z-[2]">{children}</div>
    </div>
  )
}
