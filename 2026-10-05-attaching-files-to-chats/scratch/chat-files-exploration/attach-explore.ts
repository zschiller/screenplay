import type { Page } from "playwright-core"

import { canvasPanels, ids, openChatTab } from "../helpers"
import type { Screen } from "../screen"

// H2 exploration (5 Oct 2026): how people find out chats take files.
// Scratch only, never committed.
const CLIP = "M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z"
const svg = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 256 256"><path d="${d}"></path></svg>`

const composer = (page: Page) => page.locator('[data-slot="composer"]:visible').last()

async function base(page: Page) {
  await openChatTab(page, "Checkout polish")
  await composer(page).waitFor({ timeout: 30_000 })
}

async function dragOver(page: Page) {
  await composer(page).evaluate((el) => {
    const dt = new DataTransfer()
    dt.items.add(new File(["x"], "shot.png", { type: "image/png" }))
    el.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })
    )
  })
}

async function addClip(page: Page, where: "after" | "start" | "send" = "after") {
  const target = page.getByRole("button", { name: "Target an element" }).last()
  await target.evaluate((btn, [icon, where]) => {
    const clone = btn.cloneNode(true) as HTMLElement
    clone.removeAttribute("data-state")
    btn.parentElement!.insertBefore(clone, btn)
    btn.setAttribute("aria-label", "Attach files")
    btn.removeAttribute("disabled")
    btn.querySelector("svg")!.outerHTML = icon
    // The footer addon holds the model pill first, Send last.
    let footer = btn.parentElement!
    while (footer.parentElement && !footer.matches('[data-slot="input-group-addon"]')) footer = footer.parentElement
    let child = btn as HTMLElement
    while (child.parentElement !== footer) child = child.parentElement!
    if (where === "start") {
      footer.insertBefore(child, footer.firstElementChild)
      // Mirror the model pill's -ml-1.5 so the clip's icon lines up with the text above.
      child.style.marginLeft = "-6px"
      const pill = child.nextElementSibling as HTMLElement
      if (pill) pill.style.marginLeft = "0"
    } else if (where === "send") {
      const send = footer.lastElementChild as HTMLElement
      footer.insertBefore(child, send)
      child.style.marginLeft = "auto"
      send.style.marginLeft = "4px"
    }
  }, [svg(CLIP), where] as const)
}

async function dropCue(page: Page, kind: "ring" | "cover" | "tag") {
  await dragOver(page)
  if (kind === "ring") return
  await composer(page).evaluate((el, [icon, kind]) => {
    const box = el.querySelector('[data-slot="input-group"]') as HTMLElement
    const r = box.getBoundingClientRect()
    const o = document.createElement("div")
    if (kind === "cover") {
      o.style.cssText = `position:fixed;left:${r.left + 1}px;top:${r.top + 1}px;width:${r.width - 2}px;height:${r.height - 2}px;z-index:50;border-radius:inherit`
      o.className = "flex items-center justify-center gap-2 rounded-md bg-background text-sm font-medium text-foreground"
      o.innerHTML = `<span class="text-base text-muted-foreground">${icon}</span>Drop files to attach`
      // Match the input group's own fill (input/30 over the page in dark).
      const fill = getComputedStyle(box).backgroundColor
      o.style.background = `linear-gradient(${fill}, ${fill}), var(--background)`
    } else {
      o.className = "inverted fixed z-50 flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs text-foreground shadow-md"
      o.innerHTML = `<span class="text-sm">${icon}</span>Drop files to attach`
      document.body.appendChild(o)
      const w = o.getBoundingClientRect().width
      o.style.left = `${r.left + r.width / 2 - w / 2}px`
      o.style.top = `${r.top - 34}px`
      return
    }
    document.body.appendChild(o)
  }, [svg(CLIP), kind] as const)
}

async function retip(page: Page, text: string) {
  const tip = page.locator('[data-slot="tooltip-content"]').last()
  await tip.waitFor({ timeout: 5000 })
  await tip.evaluate((el, t) => {
    el.querySelectorAll('[data-slot="kbd"], [data-slot="kbd-group"]').forEach((k) => k.remove())
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let first = true
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue
      n.textContent = first ? t : ""
      first = false
    }
  }, text)
  await page.waitForTimeout(300)
}

const common = {
  path: `/${ids.rooms.checkout}`,
  cookies: canvasPanels({ chatPct: 30 }),
  settleMs: 400,
}

const r2 = (name: string, fn: (page: Page) => Promise<void>): Screen => ({
  ...common,
  name,
  description: "H2 round 2",
  prepare: async (page) => {
    await base(page)
    await fn(page)
  },
})

const screens: Screen[] = [
  r2("z-idle", (p) => addClip(p, "send")),
  r2("z-tip", async (p) => {
    await addClip(p, "send")
    await p.getByRole("button", { name: "Attach files" }).last().hover()
    await retip(p, "Attach files")
  }),
  r2("z-drag", async (p) => { await addClip(p, "send"); await dropCue(p, "cover") }),
  r2("y-start", (p) => addClip(p, "start")),
  r2("y-send", (p) => addClip(p, "send")),
  r2("y-ring", async (p) => { await addClip(p); await dropCue(p, "ring") }),
  r2("y-cover", async (p) => { await addClip(p); await dropCue(p, "cover") }),
  r2("y-tag", async (p) => { await addClip(p); await dropCue(p, "tag") }),
  {
    ...common,
    name: "x-today",
    description: "H2: chat composer today",
    prepare: base,
  },
  {
    ...common,
    name: "x-today-drag",
    description: "H2: today, a file dragged over the composer",
    prepare: async (page) => {
      await base(page)
      await dragOver(page)
    },
  },
  {
    ...common,
    name: "x-a",
    description: "H2 A: paperclip button",
    prepare: async (page) => {
      await base(page)
      await addClip(page)
    },
  },
  {
    ...common,
    name: "x-a-tip",
    description: "H2 A: paperclip button hovered",
    prepare: async (page) => {
      await base(page)
      await addClip(page)
      await page.getByRole("button", { name: "Attach files" }).last().hover()
      await retip(page, "Attach files")
    },
  },
  {
    ...common,
    name: "x-b",
    description: "H2 B: placeholder hint",
    prepare: async (page) => {
      await base(page)
      await composer(page).evaluate((el) => {
        const ph = [...el.querySelectorAll("div")].find((d) => d.children.length === 0 &&
          d.textContent?.startsWith("Ask the agent")
        )
        if (ph) ph.textContent = "Ask the agent… (@ document, / skill, drop files)"
      })
    },
  },
  {
    ...common,
    name: "x-c",
    description: "H2 C: / menu offers Attach files",
    prepare: async (page) => {
      await page.getByText("Ask about this canvas").first().waitFor({ timeout: 30_000 })
      await page.locator(".tiptap:visible").last().click()
      await page.keyboard.type("/")
      const item = page.locator("[cmdk-item]").first()
      await item.waitFor({ timeout: 15_000 })
      await page.evaluate((icon) => {
        const group = document.querySelector("[cmdk-group]") as HTMLElement
        const copy = group.cloneNode(true) as HTMLElement
        const heading = copy.querySelector("[cmdk-group-heading]")
        if (heading) heading.textContent = "Files"
        const items = [...copy.querySelectorAll("[cmdk-item]")]
        items.slice(1).forEach((i) => i.remove())
        const it = items[0] as HTMLElement
        it.setAttribute("data-selected", "true")
        it.setAttribute("aria-selected", "true")
        const spans = it.querySelectorAll(":scope > span")
        const row = spans[0] as HTMLElement
        row.querySelector("svg")!.outerHTML = icon
        const name = row.querySelector(".font-medium")!
        name.textContent = "Attach files"
        const src = row.querySelector(".ml-auto")
        if (src) src.textContent = ""
        ;(spans[1] as HTMLElement).textContent =
          "A screenshot, PDF, text or code file, up to 25 MB"
        group.parentElement!.insertBefore(copy, group)
        for (const other of group.querySelectorAll("[cmdk-item]")) {
          other.setAttribute("data-selected", "false")
          other.setAttribute("aria-selected", "false")
        }
      }, svg(CLIP).replace("<svg ", '<svg class="text-muted-foreground" '))
    },
  },
  {
    ...common,
    name: "x-d",
    description: "H2 D: drop target over the whole chat while dragging",
    prepare: async (page) => {
      await base(page)
      await dragOver(page)
      await composer(page).evaluate((el, icon) => {
        // The chat panel: the widest ancestor no wider than the composer + gutters.
        let panel = el as HTMLElement
        const w = el.getBoundingClientRect().width
        while (panel.parentElement && panel.parentElement.getBoundingClientRect().width < w + 80)
          panel = panel.parentElement
        const r = panel.getBoundingClientRect()
        const c = el.getBoundingClientRect()
        const o = document.createElement("div")
        o.style.cssText = `position:fixed;left:${r.left}px;top:${r.top + 64}px;width:${r.width}px;height:${c.top - r.top - 64 - 8}px;z-index:50`
        o.className = "flex flex-col items-center justify-center gap-1 bg-background/90 text-center"
        o.innerHTML = `<span class="mb-1 text-2xl text-muted-foreground">${icon}</span><span class="text-sm font-medium text-foreground">Drop files to attach</span><span class="text-xs text-muted-foreground">A screenshot, PDF, text or code file, up to 25 MB</span>`
        document.body.appendChild(o)
      }, svg(CLIP))
    },
  },
]

export default screens
