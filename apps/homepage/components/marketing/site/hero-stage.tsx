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
  { ws: "Centered hero", cls: "center", diff: [6, 2] },
  { ws: "Pill buttons", cls: "pill", diff: [2, 2] },
  { ws: "Mono headline", cls: "mono", diff: [3, 1], not: "sans" },
  { ws: "Bigger headline", cls: "big", diff: [1, 1] },
  { ws: "Accent button", cls: "accent-btn", diff: [2, 0] },
  { ws: "Sans headline", cls: "sans", diff: [4, 2], not: "mono" },
  { ws: "Blue accent", cls: "blue", diff: [1, 1] },
]

// What each copy has already done when the page loads, so the first frame
// shows variety. Index 0 is main, untouched.
const SEED = [[], [1], [0], [2, 3], [4], [6, 3], [7, 1], [5], [8, 2]]

const PAGE = `
  <div class="hc-page">
    <div class="hc-nav"><span class="hc-logo"><i></i>Screenplay</span><span class="hc-links"><span>How it works</span><span>Features</span><span>Docs</span></span><span class="hc-dl">Download</span></div>
    <div class="hc-hero">
      <div class="hc-eye">Open source · Claude Code, Codex &amp; opencode</div>
      <div class="hc-h1">${HEAD}</div>
      <div class="hc-row"><p class="hc-lede">Screenplay runs each coding agent on its own branch and shows every result live on one canvas.</p><div class="hc-btns"><span class="hc-b solid">Download for Mac</span><span class="hc-b">Star on GitHub</span></div></div>
      <div class="hc-fig"><span></span><span></span><span></span></div>
    </div>
  </div>`

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
 * Workspace an agent is changing live, under a dither in the page's own
 * background colour that keeps the text on top readable. Everything marked
 * `data-veil` inside gets solid background behind its lines.
 *
 * The copies are built on the client only; they're decoration, hidden from
 * assistive tech. With reduced motion they hold still.
 */
export function HeroStage({ children }: { children: React.ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = stage.current!
    const rowsEl = strip.current!
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    const veil = createDitherVeil(canvas.current!, () => [
      ...host.querySelectorAll("[data-veil]"),
    ])
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
          el.innerHTML = `<div class="hc-head"><span></span><span class="hc-diff"></span></div><div class="hc-box">${PAGE}</div>`
          const f: Copy = {
            el,
            page: el.querySelector(".hc-page")!,
            box: el.querySelector(".hc-box")!,
            h1: el.querySelector(".hc-h1")!,
            name: el.querySelector(".hc-head span")!,
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

    // Every so often one copy on screen changes: an agent edit, or, after a
    // few, it wipes back to main and starts over.
    async function tick() {
      while (alive) {
        await wait(1300)
        if (!alive) return
        const s = rowsEl.getBoundingClientRect()
        const onScreen = copies.filter((f) => {
          const r = f.el.getBoundingClientRect()
          return !f.busy && r.left > s.left + 20 && r.right < s.right - 20
        })
        const f = onScreen[Math.floor(Math.random() * onScreen.length)]
        if (!f) continue
        f.busy = true
        if (f.done.length >= 3) {
          f.box.classList.add("wipe")
          await wait(700)
          f.page.className = "hc-page"
          f.h1.textContent = HEAD
          f.done = []
          label(f)
          f.box.classList.remove("wipe")
        } else {
          const blocked = new Set(
            f.done.flatMap((i) => [EDITS[i]!.cls, EDITS[i]!.not])
          )
          const pool = EDITS.map((_, i) => i).filter(
            (i) => !f.done.includes(i) && !blocked.has(EDITS[i]!.cls)
          )
          const i = pool[Math.floor(Math.random() * pool.length)]!
          f.done.push(i)
          label(f)
          const e = EDITS[i]!
          if (e.type) await type(f, nextHeadline())
          else {
            f.page.classList.add(e.cls!)
            await wait(800)
          }
        }
        f.busy = false
      }
    }

    const play = () => {
      if (reduce || alive) return
      alive = true
      host.dataset.playing = ""
      veil.start()
      void tick()
    }
    const pause = () => {
      alive = false
      delete host.dataset.playing
      veil.stop()
      timers.forEach(clearTimeout)
      timers.clear()
      copies.forEach((f) => (f.busy = false))
    }

    const remeasure = () => {
      veil.measure()
      if (reduce || !alive) veil.drawOnce()
    }
    veil.setColor(getComputedStyle(host).backgroundColor)
    remeasure()
    // Webfonts change where the lines fall.
    void document.fonts.ready.then(remeasure)

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
      resize.disconnect()
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
      <div className="relative z-[2]">{children}</div>
    </div>
  )
}
