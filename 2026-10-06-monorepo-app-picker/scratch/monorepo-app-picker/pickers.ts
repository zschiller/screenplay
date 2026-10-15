import { appendFileSync } from "node:fs"
import type { Page } from "playwright-core"
import type { Screen } from "../screen"
import { CHAT_WORKSPACE, openChatsMenu, selectWorkspace } from "../helpers"
import { CORE_SCREENS } from "../core"

async function measure(page: Page, label: string) {
  const m = await page.evaluate(`(() => {
    const pop = document.querySelector("[data-slot=popover-content]") || document.querySelector("[data-chats-menu]")
    if (!pop) return { none: true }
    const cs = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return { box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], bg: s.backgroundColor, color: s.color, border: s.borderTopWidth + " " + s.borderTopColor, radius: s.borderRadius, shadow: s.boxShadow.slice(0, 80), font: s.fontSize + "/" + s.lineHeight + " " + s.fontWeight + " " + s.fontFamily.slice(0, 20), pad: s.padding } }
    const pick = (sel) => { const e = pop.querySelector(sel); return e ? cs(e) : null }
    return { pop: cs(pop), inputWrap: pick("[data-slot=command-input-wrapper]"), inputGroup: pick("[data-slot=input-group]"), input: pick("[data-slot=command-input]"), heading: pick("[cmdk-group-heading]"), item: pick("[data-slot=command-item]"), itemSel: pick("[data-slot=command-item][data-selected=true]"), list: pick("[data-slot=command-list]") }
  })()`)
  appendFileSync("/tmp/claude-0/-home-user-screenplay/a8a49d29-03fe-50c9-8dbd-b70d13822d29/scratchpad/pickers.jsonl", JSON.stringify({ label, ...(m as object) }) + "\n")
}
const ws = CORE_SCREENS.find((s) => s.name === "workspaces-menu")!
const repo = CORE_SCREENS.find((s) => s.name === "add-project-github")!
const screens: Screen[] = [
  { ...ws, name: "picker-chats", prepare: async (page) => { await ws.prepare!(page); await measure(page, "chats") } },
  { ...repo, name: "picker-repo", prepare: async (page) => { await repo.prepare!(page); await measure(page, "repo") } },
]
export default screens
