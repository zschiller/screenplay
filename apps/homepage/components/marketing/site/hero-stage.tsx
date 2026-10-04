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
  "Ten agents, zero tabs.",
  "Try it three ways at once.",
  "Your repo, in parallel.",
  "Pick the best one. Merge.",
]

/** What an agent can do to a copy: its Workspace name, a class to add (or a
 * headline to type) and the diff it shows. Two edits in the same `group`
 * can't combine. */
const EDITS: {
  ws: string
  cls?: string
  type?: true
  diff: [number, number]
  group?: string
}[] = [
  { ws: "New headline", type: true, diff: [1, 1] },
  { ws: "Tinted page", cls: "soft", diff: [3, 1], group: "theme" },
  { ws: "Centered hero", cls: "center", diff: [6, 2], group: "layout" },
  { ws: "Split hero", cls: "split", diff: [9, 4], group: "layout" },
  { ws: "Feature cards", cls: "cards", diff: [14, 3] },
  { ws: "Launch banner", cls: "banner", diff: [5, 0] },
  { ws: "Pill buttons", cls: "pill", diff: [2, 2] },
  { ws: "Mono headline", cls: "mono", diff: [3, 1], group: "face" },
  { ws: "Bigger headline", cls: "big", diff: [1, 1] },
  { ws: "Accent button", cls: "accent-btn", diff: [2, 0] },
  { ws: "Sans headline", cls: "sans", diff: [4, 2], group: "face" },
  { ws: "Blue accent", cls: "blue", diff: [1, 1] },
  // The wild ones: a whole new look in one edit.
  { ws: "Paper theme", cls: "paper", diff: [38, 12], group: "theme" },
  { ws: "Hot pink", cls: "pink", diff: [27, 9], group: "theme" },
  { ws: "Brutalist", cls: "acid", diff: [44, 17], group: "theme" },
  { ws: "Sunset gradient", cls: "sunset", diff: [19, 6], group: "theme" },
  { ws: "Terminal", cls: "term", diff: [52, 23], group: "theme" },
  { ws: "Blueprint", cls: "blueprint", diff: [31, 8], group: "theme" },
  { ws: "Mint theme", cls: "mint", diff: [22, 7], group: "theme" },
  { ws: "Lavender theme", cls: "lavender", diff: [24, 9], group: "theme" },
  { ws: "Tangerine", cls: "tangerine", diff: [18, 5], group: "theme" },
  { ws: "Newsprint", cls: "news", diff: [41, 15], group: "theme" },
  { ws: "Tilted hero", cls: "tilt", diff: [7, 1] },
  { ws: "Outline headline", cls: "outline", diff: [5, 2] },
]

// Copies in one run of a row; each row holds two runs.
const RUN = 12
// Edits a copy holds before an agent swaps one out instead of adding one.
const MAX = 4
// Agents in the opening crowd.
const OPENERS = 12
// Seconds the fade-in takes to reach the copy furthest from the middle.
const REVEAL = 1.4

// A fixed sequence of random numbers, so every visit starts the same.
function sequence(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

    // Every copy starts as main, today's homepage, and the agents take them
    // apart from there. Without motion nothing would ever change, so then
    // each copy is dealt a hand up front: nothing, or up to three edits that
    // can combine, under half of them with a theme.
    const rand = sequence(7)
    const themes = EDITS.flatMap((e, i) => (e.group === "theme" ? [i] : []))
    const rest = EDITS.flatMap((e, i) => (e.group === "theme" ? [] : [i]))
    const deal = () => {
      const hand: number[] = []
      if (rand() < 0.15) return hand
      if (rand() < 0.45) hand.push(themes[Math.floor(rand() * themes.length)]!)
      for (let n = Math.floor(rand() * 3); n > 0; n--) {
        const i = rest[Math.floor(rand() * rest.length)]!
        const g = EDITS[i]!.group
        if (
          !hand.includes(i) &&
          !(g && hand.some((j) => EDITS[j]!.group === g))
        )
          hand.push(i)
      }
      return hand
    }

    // Rows panning alternate ways at slightly different speeds; each holds two
    // runs of the same length, so the loop is seamless at -50%.
    const copies: Copy[] = []
    const near: Copy[] = []
    for (let row = 0; row < ROWS; row++) {
      const track = document.createElement("div")
      track.className = "hc-track"
      track.style.animationDuration = `${80 + row * 6}s`
      track.style.animationDelay = `${-row * 13}s`
      for (let rep = 0; rep < 2; rep++) {
        for (let n = 0; n < RUN; n++) {
          const seed = reduce ? deal() : []
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

    // The copies in view fade in from the middle of the window outwards;
    // the rest are simply there. The agents start as the last one lands.
    let opensAt = 0
    if (!reduce) {
      const s = host.getBoundingClientRect()
      const floor = rowsEl.parentElement!.getBoundingClientRect()
      const cx = s.left + s.width / 2
      const cy = floor.top + floor.height / 2
      const seen = copies.flatMap((f) => {
        const r = f.el.getBoundingClientRect()
        if (r.right < s.left || r.left > s.right || r.bottom < floor.top)
          return []
        const d = Math.hypot(
          r.left + r.width / 2 - cx,
          r.top + r.height / 2 - cy
        )
        return [{ f, d }]
      })
      const far = Math.max(...seen.map((c) => c.d), 1)
      for (const { f, d } of seen)
        f.el.style.setProperty("--hc-in", `${((d / far) * REVEAL).toFixed(2)}s`)
      opensAt = performance.now() + (REVEAL + 0.3) * 1000
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

    // The opening: a crowd of agents gives every copy its first edit, the
    // ones in view first, so the floor has diverged within a few seconds.
    async function opener(delay: number) {
      await wait(delay)
      while (alive) {
        const s = host.getBoundingClientRect()
        const fresh = copies.filter((f) => !f.busy && !f.done.length)
        const seen = fresh.filter((f) => {
          const r = f.el.getBoundingClientRect()
          return r.right > s.left && r.left < s.right
        })
        const pool = seen.length ? seen : fresh
        const f = pool[Math.floor(Math.random() * pool.length)]
        if (!f) return
        await edit(f, true)
        await wait(60 + Math.random() * 120)
      }
    }
    // After that a few agents at once each keep picking a copy on screen and
    // changing it or, once it's full, swapping one of its edits out.
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
    async function edit(f: Copy, quick = false) {
      f.busy = true
      f.el.classList.add("working")
      if (f.done.length >= MAX) {
        // Full: back one edit out, so the next visit can add another. A
        // copy never goes all the way back to main.
        await wait(400)
        const at = Math.floor(Math.random() * f.done.length)
        const e = EDITS[f.done.splice(at, 1)[0]!]!
        label(f)
        if (e.type) await type(f, HEAD)
        else {
          f.page.classList.remove(e.cls!)
          await wait(550)
        }
      } else {
        const taken = new Set(f.done.map((i) => EDITS[i]!.group))
        // The opening crowd doesn't stop to type.
        const pool = EDITS.map((_, i) => i).filter(
          (i) =>
            !f.done.includes(i) &&
            !taken.has(EDITS[i]!.group) &&
            !(quick && EDITS[i]!.type)
        )
        const i = pool[Math.floor(Math.random() * pool.length)]!
        // The agent thinks for a moment, then the change lands.
        await wait(quick ? 150 : 600)
        if (!alive) return
        f.done.push(i)
        label(f)
        const e = EDITS[i]!
        if (e.type) await type(f, nextHeadline())
        else {
          f.page.classList.add(e.cls!)
          await wait(quick ? 300 : 900)
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
      const hold = Math.max(opensAt - performance.now(), 0)
      for (let k = 0; k < OPENERS; k++) void opener(hold + k * 70)
      for (let k = 0; k < 3; k++) void agent(hold + k * 450)
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
