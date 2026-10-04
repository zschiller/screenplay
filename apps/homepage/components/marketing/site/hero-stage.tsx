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
  "Branch it. See it. Ship it.",
  "A canvas for your codebase.",
  "Mock it up in your real code.",
  "Stop guessing. Compare.",
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
  { ws: "Midnight", cls: "midnight", diff: [21, 8], group: "theme" },
  { ws: "Forest", cls: "forest", diff: [23, 6], group: "theme" },
  { ws: "Wine", cls: "wine", diff: [20, 7], group: "theme" },
  { ws: "Sand", cls: "sand", diff: [26, 11], group: "theme" },
  { ws: "Sky", cls: "sky", diff: [22, 9], group: "theme" },
  { ws: "Lemon", cls: "lemon", diff: [17, 4], group: "theme" },
  { ws: "Coral", cls: "coral", diff: [19, 6], group: "theme" },
  { ws: "High contrast", cls: "ink", diff: [33, 14], group: "theme" },
  { ws: "Clean light", cls: "chalk", diff: [29, 13], group: "theme" },
  { ws: "Grape", cls: "grape", diff: [18, 5], group: "theme" },
  { ws: "Teal", cls: "teal", diff: [21, 6], group: "theme" },
  { ws: "Rose", cls: "rose", diff: [24, 8], group: "theme" },
  { ws: "Aurora gradient", cls: "aurora", diff: [27, 7], group: "theme" },
  { ws: "Candy gradient", cls: "candy", diff: [25, 6], group: "theme" },
  { ws: "Slate", cls: "slate", diff: [16, 5], group: "theme" },
  { ws: "Dotted", cls: "dots", diff: [12, 2], group: "theme" },
  { ws: "Right-aligned", cls: "right", diff: [6, 2], group: "layout" },
  { ws: "Underlined headline", cls: "under", diff: [3, 0] },
  { ws: "Boxed hero", cls: "boxed", diff: [11, 2] },
  { ws: "Stacked buttons", cls: "stack", diff: [4, 1] },
  { ws: "Caps headline", cls: "caps", diff: [3, 1] },
  { ws: "Highlighted headline", cls: "mark", diff: [5, 0] },
  { ws: "Tilted hero", cls: "tilt", diff: [7, 1] },
  { ws: "Outline headline", cls: "outline", diff: [5, 2] },
]

// Copies in one run of a row; each row holds two runs.
const RUN = 12
// Edits a copy holds before an agent swaps one out instead of adding one.
const MAX = 4
// Copies on the whole floor that can have a monospace look at once.
const CODED = 3
// Agents that keep changing copies for as long as the hero is on screen.
const AGENTS = 6
// Agents in the opening crowd, which gives every copy its first edit.
const OPENERS = 12

// A fixed sequence of random numbers, so every visit starts the same.
function sequence(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The fade-in on load, in ms: how long until the last copy starts to show,
// and how long each copy takes.
const WAVE = 5000
const FADE = 900

// Rows on the canvas floor, far to near.
const ROWS = 6
// How far above the headline the veil starts thickening, in CSS px, and how
// far down the floor the far fade reaches, so a band of rows between the two
// shows with no grain at all.
const NEAR = 200
const FAR = 0.58
// How far the pointer's swell in the floor reaches, in CSS px, and how many
// degrees a copy tips for each px it is from the pointer.
const REACH = 360
const TIP = 0.014
// The nav's height in CSS px: --hc-nav in the stylesheet.
const NAV = 61

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
  /** Its headline, and its whole look as one string to compare. */
  head: string
  look: string
  /** When it has finished fading in on load; untouched until then. */
  ready: number
  /** When it starts to fade in on load. */
  shows: number
  /** Its row, far to near, and its place along it. */
  row: number
  at: number
  busy: boolean
  /** How close the pointer is, 0 to 1. */
  near: number
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
 * on a phone, clears a hole in the veil to peek at them, and under a mouse
 * the floor swells a little, lifting and tipping the copies around it.
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
        // Denser right behind the nav, so its links read over the copies.
        [floor.top - s + NAV, 0.84],
      ]
    })
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let alive = false
    let visibleNow = false
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

    // No repeats. Once they've been changed, no two copies anywhere on the
    // floor have the same set of edits and headline. Along a row, a theme doesn't come round
    // again within two copies, two plain ones never sit side by side, and
    // neighbours don't share a new headline. Even rows and odd rows draw on
    // different halves of the themes and headlines, so the rows above and
    // below can't match either, however the rows pan past each other.
    const rand = sequence(7)
    const themes = EDITS.flatMap((e, i) => (e.group === "theme" ? [i] : []))
    const rest = EDITS.flatMap((e, i) => (e.group === "theme" ? [] : [i]))
    const rows: Copy[][] = []
    const copies: Copy[] = []
    const near: Copy[] = []
    const themeOf = (done: number[]) =>
      done.find((i) => EDITS[i]!.group === "theme") ?? -1
    const lookOf = (done: number[], head: string) =>
      `${[...done].sort((a, b) => a - b).join(".")}|${head}`
    // Still main, as every copy is on load, which isn't held against it.
    const fresh = (f: Copy) => !f.done.length
    const beside = (f: Copy, d: number) => {
      const r = rows[f.row]!
      return r[(f.at + d + r.length) % r.length]!
    }
    // The monospace looks (the terminal theme, the mono headline) read as
    // one and stand out, so only a few copies on the whole floor have one
    // at a time, and never near each other in a row.
    const coded = (done: number[]) =>
      done.some((i) => EDITS[i]!.cls === "term" || EDITS[i]!.cls === "mono")
    const fits = (f: Copy, done: number[], head: string) => {
      if (coded(done)) {
        for (const d of [-3, -2, -1, 1, 2, 3])
          if (coded(beside(f, d).done)) return false
        let n = 0
        for (const c of copies) if (c !== f && coded(c.done)) n++
        if (n >= CODED) return false
      }
      const t = themeOf(done)
      if (t >= 0) {
        if (themes.indexOf(t) % 2 !== f.row % 2) return false
        for (const d of [-2, -1, 1, 2])
          if (themeOf(beside(f, d).done) === t) return false
      } else {
        for (const d of [-1, 1]) {
          const c = beside(f, d)
          if (!fresh(c) && themeOf(c.done) < 0) return false
        }
      }
      if (head !== HEAD) {
        if (HEADLINES.indexOf(head) % 2 !== f.row % 2) return false
        for (const d of [-1, 1]) if (beside(f, d).head === head) return false
      }
      const look = lookOf(done, head)
      return !copies.some((c) => c !== f && c.look === look && !fresh(c))
    }
    const shuffled = <T,>(list: T[]) => {
      const a = [...list]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[a[i], a[j]] = [a[j]!, a[i]!]
      }
      return a
    }
    const can = (done: number[], i: number) => {
      const g = EDITS[i]!.group
      return (
        !done.includes(i) && !(g && done.some((j) => EDITS[j]!.group === g))
      )
    }
    // A whole look for a copy that has none yet: usually a theme, and up to
    // two other edits that can combine.
    const deal = (f: Copy): [done: number[], head: string] | null => {
      for (let tries = 0; tries < 40; tries++) {
        const done: number[] = []
        if (rand() < 0.6) done.push(themes[Math.floor(rand() * themes.length)]!)
        for (let n = Math.floor(rand() * 3); n > 0; n--) {
          const i = rest[Math.floor(rand() * rest.length)]!
          if (can(done, i)) done.push(i)
        }
        const head = done.some((i) => EDITS[i]!.type)
          ? HEADLINES[Math.floor(rand() * HEADLINES.length)]!
          : HEAD
        if (done.length && fits(f, done, head)) return [done, head]
      }
      // Out of luck: the first theme and one other edit that fit.
      for (const t of shuffled(themes))
        for (const i of shuffled(rest)) {
          const done = EDITS[i]!.type ? [t] : [t, i]
          if (fits(f, done, HEAD)) return [done, HEAD]
        }
      return null
    }
    const wear = (f: Copy, done: number[], head: string) => {
      for (const i of f.done) if (!done.includes(i)) remove(f, i)
      for (const i of done) {
        const e = EDITS[i]!
        if (e.cls) f.page.classList.add(e.cls)
      }
      f.h1.textContent = head
      f.done = done
      f.head = head
      f.look = lookOf(done, head)
      label(f)
    }
    const remove = (f: Copy, i: number) => {
      const e = EDITS[i]!
      if (e.cls) f.page.classList.remove(e.cls)
    }

    // Rows panning alternate ways at slightly different speeds; each holds two
    // runs of the same length, so the loop is seamless at -50%.
    for (let row = 0; row < ROWS; row++) {
      const track = document.createElement("div")
      track.className = "hc-track"
      track.style.animationDuration = `${140 + row * 10}s`
      track.style.animationDelay = `${-row * 23}s`
      rows.push([])
      for (let at = 0; at < RUN * 2; at++) {
        const el = document.createElement("div")
        // Hidden from the first frame, so nothing shows before the fade-in.
        el.className = reduce ? "hc-copy" : "hc-copy unseen"
        el.innerHTML = `<div class="hc-head">${GLYPH}<span class="hc-name"></span><span class="hc-diff"></span></div><div class="hc-box">${PAGE}</div>`
        const f: Copy = {
          el,
          page: el.querySelector(".hc-page")!,
          h1: el.querySelector(".hc-h1")!,
          name: el.querySelector(".hc-name")!,
          diff: el.querySelector(".hc-diff")!,
          done: [],
          head: HEAD,
          look: lookOf([], HEAD),
          busy: false,
          ready: 0,
          shows: 0,
          row,
          at,
          near: 0,
        }
        // Its own slight cast: see .hc-page in the stylesheet.
        el.style.setProperty("--hc-hue", ((rand() * 2 - 1) * 22).toFixed(1))
        el.style.setProperty("--hc-lift", ((rand() * 2 - 1) * 0.035).toFixed(3))
        label(f)
        track.appendChild(el)
        copies.push(f)
        rows[row]!.push(f)
        // The rows just behind the headline, which the veil leaves clear.
        if (row >= ROWS - 4 && row < ROWS - 1) near.push(f)
      }
      rowsEl.appendChild(track)
    }

    // On load the copies in view fade in one at a time, all across the
    // floor; the rest are simply there.
    let shown = 0
    if (!reduce) {
      const s = rowsEl.parentElement!.getBoundingClientRect()
      // It starts around the middle of the floor: the first four are any
      // of the dozen copies nearest it, different each visit. After them
      // it's anywhere, but each time the pick of a few is the one with the
      // fewest neighbours already showing, so they pop in scattered, with
      // gaps between them, and only close ranks towards the end.
      const cx = s.left + s.width / 2
      const cy = s.top + s.height / 2
      const placed = copies.flatMap((f) => {
        const r = f.el.getBoundingClientRect()
        if (r.right <= s.left || r.left >= s.right) return []
        const x = r.left + r.width / 2
        const far = Math.hypot(x - cx, r.top + r.height / 2 - cy)
        return [{ f, far, x, w: r.width }]
      })
      placed.sort((a, b) => a.far - b.far)
      type Placed = (typeof placed)[number]
      const beside = (a: Placed, b: Placed) =>
        Math.abs(a.f.row - b.f.row) <= 1 &&
        Math.abs(a.x - b.x) < (a.w + b.w) * 0.75
      const seen: Placed[] = []
      const crowd = (c: Placed) =>
        seen.reduce((n, o) => n + (beside(c, o) ? 1 : 0), 0)
      const left = new Set(placed)
      while (left.size) {
        const pool =
          seen.length < 4
            ? placed.slice(0, 12).filter((c) => left.has(c))
            : [...left]
        let pick = pool[Math.floor(Math.random() * pool.length)]!
        for (let tries = 0; tries < 6; tries++) {
          const c = pool[Math.floor(Math.random() * pool.length)]!
          if (crowd(c) < crowd(pick)) pick = c
        }
        seen.push(pick)
        left.delete(pick)
      }
      // The gaps between one copy and the next are uneven, from a fifth of
      // the average to nearly twice it, so they don't tick in like a clock.
      const gaps = seen.map(() => 0.2 + 1.6 * Math.random())
      const beat = WAVE / gaps.reduce((a, b) => a + b, 0)
      const from = performance.now()
      let at = 0
      seen.forEach(({ f }, n) => {
        // Each fades in as main and stays that way for a beat.
        f.ready = from + at + FADE + 500
        f.shows = from + at
        f.el.style.transitionDuration = `${FADE}ms`
        f.el.style.transitionDelay = `${Math.round(at)}ms`
        at += gaps[n]! * beat
      })
      // A frame later, so the hidden state has been drawn to fade from.
      shown = requestAnimationFrame(() => {
        for (const f of copies) f.el.classList.remove("unseen")
        shown = window.setTimeout(() => {
          for (const { f } of seen)
            f.el.style.transitionDuration = f.el.style.transitionDelay = ""
        }, WAVE + FADE)
      })
    }

    // Every copy starts as main, today's homepage, and the agents take them
    // apart from there. Without motion nothing would ever change, so then
    // each copy gets a look up front.
    if (reduce)
      for (const f of copies) {
        const look = deal(f)
        if (look) wear(f, ...look)
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

    // The opening: a crowd of agents gives each copy its first look, but
    // only once it's in view and has faded in, so every copy is first seen
    // as main. One of them keeps watch for the copies that pan in later.
    async function opener(delay: number, watch: boolean) {
      await wait(delay)
      while (alive) {
        const s = host.getBoundingClientRect()
        const now = performance.now()
        const left = copies.filter((f) => !f.busy && fresh(f))
        if (!left.length) return
        const seen = left.filter((f) => {
          if (now < f.ready) return false
          const r = f.el.getBoundingClientRect()
          return r.right > s.left + 60 && r.left < s.right - 60
        })
        const f = seen[Math.floor(Math.random() * seen.length)]
        if (!f) {
          // None to do yet: some are still fading in, or out of view.
          if (!watch && !left.some((c) => now < c.ready)) return
          await wait(300)
          continue
        }
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
          return (
            !f.busy &&
            performance.now() >= f.ready &&
            r.left > s.left + 20 &&
            r.right < s.right - 20
          )
        }
        // Half the time the rows just behind the headline, the clearest ones.
        const clear = near.filter(onScreen)
        const pool =
          clear.length && Math.random() < 0.5 ? clear : copies.filter(onScreen)
        const f = pool[Math.floor(Math.random() * pool.length)]
        if (f) await edit(f)
        await wait(500 + Math.random() * 700)
      }
    }
    // The next change to a copy that keeps to the rules above. It never
    // settles: a full copy trades one of its edits for a new one, and now
    // and then so does one with room to spare, or its headline is rewritten
    // again. A copy never goes all the way back to main.
    const next = (f: Copy): [done: number[], head: string] | null => {
      const all = EDITS.map((_, i) => i)
      const full = f.done.length >= MAX
      const roll = Math.random()
      if (!full && roll < 0.15 && f.head !== HEAD) {
        const head = shuffled(HEADLINES).find(
          (h) => h !== f.head && fits(f, f.done, h)
        )
        if (head) return [f.done, head]
      }
      if (full || (f.done.length && roll < 0.5))
        for (const out of shuffled(f.done)) {
          const kept = f.done.filter((j) => j !== out)
          const head = EDITS[out]!.type ? HEAD : f.head
          for (const i of shuffled(all)) {
            if (i === out || !can(kept, i)) continue
            const done = [...kept, i]
            const heads = EDITS[i]!.type ? shuffled(HEADLINES) : [head]
            const h = heads.find((h) => fits(f, done, h))
            if (h) return [done, h]
          }
        }
      if (!full)
        for (const i of shuffled(all)) {
          if (!can(f.done, i)) continue
          const done = [...f.done, i]
          const heads = EDITS[i]!.type ? shuffled(HEADLINES) : [f.head]
          const head = heads.find((h) => fits(f, done, h))
          if (head) return [done, head]
        }
      if (f.done.length > 1)
        for (const i of shuffled(f.done)) {
          const done = f.done.filter((j) => j !== i)
          const head = EDITS[i]!.type ? HEAD : f.head
          if (fits(f, done, head)) return [done, head]
        }
      return null
    }
    async function edit(f: Copy, quick = false) {
      // The opening crowd gives a copy a whole look at once, and doesn't
      // stop to type a headline.
      const change = quick ? deal(f) : next(f)
      if (!change) return
      const [done, head] = change
      f.busy = true
      f.el.classList.add("working")
      // Claimed before it lands, so no other copy takes the same look.
      const typed = !quick && head !== f.head
      const gone = f.done.filter((i) => !done.includes(i))
      f.done = done
      f.head = head
      f.look = lookOf(done, head)
      // The agent thinks for a moment, then the change lands.
      await wait(quick ? 150 : gone.length ? 400 : 600)
      if (!alive) return
      label(f)
      for (const i of gone) remove(f, i)
      for (const i of done) {
        const e = EDITS[i]!
        if (e.cls) f.page.classList.add(e.cls)
      }
      if (quick) f.h1.textContent = head
      if (typed) await type(f, head)
      else await wait(quick ? 300 : gone.length ? 550 : 900)
      f.el.classList.remove("working")
      f.busy = false
    }

    const play = () => {
      if (reduce || alive) return
      alive = true
      host.dataset.playing = ""
      veil.start()
      for (let k = 0; k < OPENERS; k++) void opener(400 + k * 70, !k)
      for (let k = 0; k < AGENTS; k++) void agent(k * 450)
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

    // The floor shifts by up to half a row so that the nav's bottom edge cuts
    // the row of copies nearest it through the middle.
    const lift = () => {
      host.style.setProperty("--hc-lift", "0px")
      const s = host.getBoundingClientRect().top
      let by = Infinity
      for (const track of rowsEl.children) {
        const r = track.getBoundingClientRect()
        const off = (r.top + r.bottom) / 2 - s - NAV
        if (Math.abs(off) < Math.abs(by)) by = off
      }
      if (Number.isFinite(by)) host.style.setProperty("--hc-lift", `${by}px`)
    }

    // At most once a frame, and drawn straight away, so dragging the window
    // neither stalls nor flashes an empty veil.
    let pending = 0
    const remeasure = () => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        lift()
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
    // The floor swells under the pointer: the copies around it rise a few
    // pixels and tip a degree or so off the bump. Worked out every frame
    // while the pointer is over the hero, since the rows pan under a
    // pointer that's holding still.
    let pointer: { x: number; y: number } | null = null
    let swelling = 0
    const swell = () => {
      swelling = 0
      const p = pointer
      const now = performance.now()
      for (const f of copies) {
        if (!p) {
          if (f.near) {
            f.near = 0
            f.el.style.removeProperty("--hc-near")
            f.el.style.removeProperty("--hc-rx")
            f.el.style.removeProperty("--hc-ry")
          }
          continue
        }
        const r = f.el.getBoundingClientRect()
        // A copy answers as soon as it has started to show, not once the
        // fade-in on load is over; the wait before its fade would otherwise
        // hold this up too.
        if (r.right < 0 || r.left > innerWidth || now < f.shows) continue
        if (f.el.style.transitionDelay) f.el.style.transitionDelay = ""
        const dx = p.x - (r.left + r.width / 2)
        const dy = p.y - (r.top + r.height / 2)
        const t = Math.max(0, 1 - Math.hypot(dx, dy) / REACH)
        const near = t * t * (3 - 2 * t)
        if (!near && !f.near) continue
        f.near = near
        f.el.style.setProperty("--hc-near", near.toFixed(3))
        // Tipped away from the pointer, most partway out and not at all
        // right under it. The floor is tilted back, so a step up the screen
        // is a longer one along it.
        f.el.style.setProperty("--hc-ry", (-dx * near * TIP).toFixed(2))
        f.el.style.setProperty("--hc-rx", (dy * near * TIP * 1.4).toFixed(2))
      }
      if (p) swelling = requestAnimationFrame(swell)
    }
    const point = (p: { x: number; y: number } | null) => {
      if (reduce) return
      pointer = p
      if (!swelling) swelling = requestAnimationFrame(swell)
    }

    const peekAt = (p: { clientX: number; clientY: number }) => {
      const r = host.getBoundingClientRect()
      veil.peekAt({ x: p.clientX - r.left, y: p.clientY - r.top })
      if (reduce) veil.drawOnce()
    }
    // Followed across the whole window, so the nav, which lies over the top
    // of the floor until the page scrolls, peeks too. Its links stay on top.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return
      const r = host.getBoundingClientRect()
      const inside =
        e.clientX >= r.left &&
        e.clientX < r.right &&
        e.clientY >= r.top &&
        e.clientY < r.bottom
      const header = (e.target as Element | null)?.closest?.("header")
      if (inside && !header?.hasAttribute("data-scrolled")) {
        peekAt(e)
        point({ x: e.clientX, y: e.clientY })
      } else onLeave()
    }
    const onLeave = () => {
      point(null)
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
    window.addEventListener("pointermove", onMove)
    document.documentElement.addEventListener("pointerleave", onLeave)
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
      cancelAnimationFrame(swelling)
      cancelAnimationFrame(shown)
      clearTimeout(shown)
      resize.disconnect()
      window.removeEventListener("pointermove", onMove)
      document.documentElement.removeEventListener("pointerleave", onLeave)
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
