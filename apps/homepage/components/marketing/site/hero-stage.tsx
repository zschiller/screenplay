"use client"

import { useEffect, useRef } from "react"

import { createDitherVeil } from "./dither-veil"
import "./hero-stage.css"

const HEAD = "From idea to code, on one canvas."
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

// Rows on the canvas floor, far to near.
const ROWS = 8
// How far above the headline the veil starts thickening, in CSS px, and how
// far down the floor the far fade reaches, so a band of rows between the two
// shows with no grain at all.
const NEAR = 200
const FAR = 0.58

const PAGE = `
  <div class="hc-page">
    <div class="hc-nav"><span class="hc-logo"><i></i>Screenplay</span><span class="hc-links"><span>How it works</span><span>Features</span><span>Docs</span></span><span class="hc-dl">Download</span></div>
    <div class="hc-hero">
      <div class="hc-h1">${HEAD}</div>
      <div class="hc-row"><p class="hc-lede">Coding agents plan, mock up and build from your own repo, with every version live side by side.</p><div class="hc-btns"><span class="hc-b solid">Download for Mac</span><span class="hc-b">Host it for your team</span></div></div>
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
  h1: HTMLElement
  name: HTMLElement
  diff: HTMLElement
  done: number[]
  busy: boolean
}

/**
 * The hero's backdrop: copies of this homepage lie on a canvas floor that
 * recedes to a horizon under the nav, panning past in rows, each a Workspace
 * an agent is changing live.
 * The headline, marked `data-veil`, sinks into the nearest row, and a dither in
 * the page's own background colour thickens down the floor, slowly at first,
 * to solid partway down the headline's first line, so the copies dissolve into
 * it and the text stays readable.
 *
 * The copies are built on the client only; they're decoration, hidden from
 * assistive tech. With reduced motion they hold still. Hovering, or touching
 * on a phone, clears a hole in the veil to peek at them.
 */
export function HeroStage({ children }: { children: React.ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = stage.current!
    const rowsEl = strip.current!
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    // Clear across the middle of the floor, solid halfway down the
    // headline's first line, so that line sits on the densest grain.
    const veil = createDitherVeil(canvas.current!, () => {
      const s = host.getBoundingClientRect().top
      const head = host.querySelector<HTMLElement>("[data-veil]")!
      const size = parseFloat(getComputedStyle(head).fontSize)
      const floor = rowsEl.parentElement!.getBoundingClientRect()
      const solid = head.getBoundingClientRect().top - s + size * 0.6
      return [
        solid - NEAR,
        solid,
        // The far side of the floor dissolves into the dark behind the nav
        // through the same grain, solid only at the very top of the page.
        [floor.top - s, floor.top - s + floor.height * FAR],
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

    // Rows panning alternate ways at slightly different speeds; each holds two
    // identical runs, so the loop is seamless at -50%.
    const copies: Copy[] = []
    const near: Copy[] = []
    for (let row = 0; row < ROWS; row++) {
      const k = (row * 4) % SEED.length
      const seeds = [...SEED.slice(k), ...SEED.slice(0, k)]
      const track = document.createElement("div")
      track.className = "hc-track"
      track.style.animationDuration = `${80 + row * 6}s`
      track.style.animationDelay = `${-row * 13}s`
      for (let rep = 0; rep < 2; rep++) {
        for (const seed of seeds) {
          const el = document.createElement("div")
          el.className = "hc-copy"
          el.innerHTML = `<div class="hc-head">${GLYPH}<span class="hc-name"></span><span class="hc-diff"></span></div><div class="hc-box">${PAGE}</div>`
          const f: Copy = {
            el,
            page: el.querySelector(".hc-page")!,
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
          // The rows just behind the headline, which the veil leaves clear.
          if (row >= ROWS - 4 && row < ROWS - 1) near.push(f)
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
    // it, or, after a few edits, undoing them back to main to start over.
    async function agent(delay: number) {
      await wait(delay)
      while (alive) {
        const s = host.getBoundingClientRect()
        const onScreen = (f: Copy) => {
          const r = f.el.getBoundingClientRect()
          return !f.busy && r.left > s.left + 20 && r.right < s.right - 20
        }
        // Mostly the rows just behind the headline, the nearest clear ones.
        const clear = near.filter(onScreen)
        const pool =
          clear.length && Math.random() < 0.75 ? clear : copies.filter(onScreen)
        const f = pool[Math.floor(Math.random() * pool.length)]
        if (f) await edit(f)
        await wait(500 + Math.random() * 700)
      }
    }
    async function edit(f: Copy) {
      f.busy = true
      f.el.classList.add("working")
      if (f.done.length >= 3) {
        // Back out the edits one at a time, newest first, until it's main.
        await wait(400)
        while (f.done.length && alive) {
          const e = EDITS[f.done.pop()!]!
          label(f)
          if (e.type) await type(f, HEAD)
          else {
            f.page.classList.remove(e.cls!)
            await wait(550)
          }
        }
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

    // Hovering, or a finger on a touch screen, clears a hole in the veil to
    // peek at the copies underneath.
    const peekAt = (p: { clientX: number; clientY: number }) => {
      const r = host.getBoundingClientRect()
      veil.peekAt({ x: p.clientX - r.left, y: p.clientY - r.top })
      if (reduce) veil.drawOnce()
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") peekAt(e)
    }
    const onLeave = () => {
      veil.peekAt(null)
      if (reduce) veil.drawOnce()
    }
    // Touch events rather than pointer events: the browser cancels a touch
    // pointer as soon as the page starts to scroll, but touchmove keeps
    // coming, so a swipe stirs the veil without stopping the scroll.
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) peekAt(t)
      else onLeave()
    }
    host.addEventListener("pointermove", onMove)
    host.addEventListener("pointerleave", onLeave)
    const touches = [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
    ] as const
    for (const type of touches)
      host.addEventListener(type, onTouch, { passive: true })

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
      for (const type of touches) host.removeEventListener(type, onTouch)
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
