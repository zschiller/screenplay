import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  DRIVE_GAPS,
  type DriveElements,
  type DriveGap,
  type DriveOp,
  type DriveResult,
  type FrameDriveBackend,
} from "@/lib/frame-drive/contract"

/**
 * The Frame Drive contract (#1389): one scenario every backend runs, so the
 * agent's tools behave the same wherever Screenplay runs. The Mac backend runs
 * it against the Sandbox Bridge in a test page (`mac/mac-backend.test.ts`);
 * the hosted backend (#1396) runs it against a real headless Chromium
 * (`hosted/hosted-backend.test.ts`).
 *
 * Everything is checked from outside, through the contract's own ops: the
 * suite loads a page, drives it, and reads what changed.
 */
/** The least a step at show pace takes: the cursor's glide and pause. */
export const SHOW_STEP_MIN_MS = 700

export interface FrameDriveHarness {
  backend: FrameDriveBackend
  /** The frame the backend drives. */
  frameId: string
  /** Show `html` as the frame's page, running its inline scripts. */
  load(html: string): Promise<void>
  /** Whether the page ran `window.__evaluated = true` from anywhere. */
  evaluated(): Promise<boolean>
}

export function frameDriveContract(
  name: string,
  opts: {
    setup: () => Promise<FrameDriveHarness>
    /** The gestures this runtime can't make for real (the Mac's #1367
     *  gaps). Each must come back as that gap; any other must not. */
    gaps: readonly DriveGap[]
    /** Skip it where the runtime can't run (no browser stack). */
    skip?: boolean
  }
) {
  describe.skipIf(!!opts.skip)(`Frame Drive contract: ${name}`, () => {
    let h: FrameDriveHarness
    beforeAll(async () => {
      h = await opts.setup()
    })

    const run = (op: DriveOp | Record<string, unknown>) =>
      h.backend.run(h.frameId, op as DriveOp)
    const read = async (selector?: string): Promise<DriveElements> => {
      const result = await run({ op: "elements", selector })
      expect(result.status).toBe("read")
      return (result as Extract<DriveResult, { status: "read" }>).value
    }
    const out = async () => (await read("#out")).read?.text.trim()
    const expectDone = (result: DriveResult) => {
      expect(result, JSON.stringify(result)).toMatchObject({ status: "done" })
    }

    describe("reads", () => {
      beforeEach(() =>
        h.load(`
          <h1>Settings</h1>
          <a href="#billing">Billing</a>
          <button id="save">Save</button>
          <label>Email <input id="email" value="a@b.co"></label>
          <input type="checkbox" id="news" aria-label="Newsletter" checked>
          <button hidden>Hidden</button>
          <p id="out">Nothing yet</p>`)
      )

      it("lists what can be acted on, each with a selector and label", async () => {
        const page = await read()
        const byLabel = new Map(page.elements.map((e) => [e.label, e]))
        expect(byLabel.get("Billing")?.tag).toBe("a")
        expect(byLabel.get("Save")?.selector).toBe("#save")
        expect(byLabel.get("Email")?.value).toBe("a@b.co")
        expect(byLabel.get("Newsletter")?.checked).toBe(true)
        expect(byLabel.has("Hidden")).toBe(false)
        expect(typeof page.path).toBe("string")
      })

      it("reads one element's text, or says it matches nothing", async () => {
        expect(await out()).toBe("Nothing yet")
        expect((await read("#missing")).read).toBeNull()
      })
    })

    describe("gestures", () => {
      beforeEach(() =>
        h.load(`
          <button id="save" onclick="document.getElementById('out').textContent = 'saved'">Save</button>
          <div role="button" id="menu-trigger">Plan</div>
          <input type="checkbox" id="news" aria-label="Newsletter">
          <form id="form" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'submitted ' + document.getElementById('name').value">
            <input id="name" aria-label="Name" oninput="document.getElementById('out').textContent = 'typed ' + this.value">
          </form>
          <select id="size" aria-label="Size" onchange="document.getElementById('out').textContent = 'size ' + this.value">
            <option value="s">Small</option><option value="l">Large</option>
          </select>
          <div id="slider" role="slider" aria-label="Volume">knob</div>
          <div id="track" aria-label="Track" role="button">track</div>
          <p id="out">idle</p>
          <script>
            // A menu that opens on pointerdown, as Radix's do.
            document.getElementById("menu-trigger").addEventListener("pointerdown", () => {
              const item = document.createElement("div")
              item.setAttribute("role", "menuitem")
              item.textContent = "Pro"
              item.addEventListener("click", () => { document.getElementById("out").textContent = "picked Pro" })
              document.body.appendChild(item)
            })
            // A shortcut the page handles itself.
            document.addEventListener("keydown", (e) => {
              if (e.key === "k" && e.metaKey) document.getElementById("out").textContent = "palette"
            })
            // A pointer-driven slider (pointer capture can't be taken by a
            // synthetic pointer, so it listens on the document).
            let dragging = false
            document.getElementById("slider").addEventListener("pointerdown", () => { dragging = true })
            document.addEventListener("pointermove", () => { if (dragging) document.getElementById("out").textContent = "dragging" })
            document.addEventListener("pointerup", () => { if (dragging) { dragging = false; document.getElementById("out").textContent = "dropped" } })
          </script>`)
      )

      it("clicks a button the page listens to", async () => {
        expectDone(await run({ op: "click", target: { text: "Save" } }))
        expect(await out()).toBe("saved")
      })

      it("opens a menu that listens for pointerdown, then picks from it", async () => {
        expectDone(
          await run({ op: "click", target: { selector: "#menu-trigger" } })
        )
        const page = await read()
        expect(page.elements.some((e) => e.label === "Pro")).toBe(true)
        expectDone(await run({ op: "click", target: { text: "Pro" } }))
        expect(await out()).toBe("picked Pro")
      })

      it("toggles a checkbox", async () => {
        expectDone(await run({ op: "click", target: { text: "Newsletter" } }))
        expect((await read("#news")).read?.checked).toBe(true)
      })

      it("types into a field the page listens to, and replaces its value", async () => {
        const typed = await run({
          op: "type",
          target: { text: "Name" },
          text: "Ada",
        })
        expectDone(typed)
        expect(await out()).toBe("typed Ada")
        const replaced = await run({
          op: "type",
          target: { selector: "#name" },
          text: "Grace",
          replace: true,
        })
        expect(replaced).toMatchObject({ value: { value: "Grace" } })
      })

      it("submits a field's form with Enter", async () => {
        await run({ op: "type", target: { selector: "#name" }, text: "Ada" })
        expectDone(
          await run({ op: "key", key: "Enter", target: { selector: "#name" } })
        )
        expect(await out()).toBe("submitted Ada")
      })

      it("sends a shortcut the page handles", async () => {
        expectDone(
          await run({ op: "key", key: "k", modifiers: { metaKey: true } })
        )
        expect(await out()).toBe("palette")
      })

      it("picks an option in a native select by its text", async () => {
        const result = await run({
          op: "select",
          target: { text: "Size" },
          value: "Large",
        })
        expect(result).toMatchObject({ status: "done", value: { value: "l" } })
        expect(await out()).toBe("size l")
      })

      it("drags with pointer events", async () => {
        expectDone(
          await run({
            op: "drag",
            target: { selector: "#slider" },
            to: { selector: "#track" },
          })
        )
        expect(await out()).toBe("dropped")
      })

      it("scrolls the page", async () => {
        expectDone(await run({ op: "scroll", dy: 200 }))
      })

      it("says when no element matches the target", async () => {
        expect(
          await run({ op: "click", target: { selector: "#nope" } })
        ).toMatchObject({ status: "not-found" })
      })

      // "Show me" (#1390): the same outcome, at a pace a person can watch.
      it("plays a gesture at show pace, slower but to the same end", async () => {
        const startedShow = Date.now()
        expectDone(
          await run({ op: "click", target: { text: "Save" }, pace: "show" })
        )
        const show = Date.now() - startedShow
        expect(await out()).toBe("saved")
        const startedJump = Date.now()
        expectDone(
          await run({ op: "click", target: { text: "Save" }, pace: "jump" })
        )
        const jump = Date.now() - startedJump
        expect(show).toBeGreaterThanOrEqual(SHOW_STEP_MIN_MS)
        expect(jump).toBeLessThan(SHOW_STEP_MIN_MS)
      })

      it("types at show pace, ending with the whole text", async () => {
        const typed = await run({
          op: "type",
          target: { selector: "#name" },
          text: "Ada",
          pace: "show",
        })
        expect(typed).toMatchObject({ status: "done", value: { value: "Ada" } })
        expect(await out()).toBe("typed Ada")
      })
    })

    describe("gestures it can't make for real", () => {
      beforeEach(() =>
        h.load(`
          <input type="file" id="upload" aria-label="Upload">
          <input type="date" id="when" aria-label="When">
          <select id="size" aria-label="Size"><option>S</option></select>
          <input id="name" aria-label="Name">
          <div contenteditable="true" id="notes" aria-label="Notes"></div>
          <button id="copy" onclick="navigator.clipboard && navigator.clipboard.writeText('link').catch(() => {})">Copy link</button>`)
      )

      const cases: [DriveGap, DriveOp][] = [
        ["file-picker", { op: "click", target: { selector: "#upload" } }],
        ["native-picker", { op: "click", target: { selector: "#when" } }],
        ["native-select", { op: "click", target: { selector: "#size" } }],
        ["tab", { op: "key", key: "Tab" }],
        ["key-typing", { op: "key", key: "a", target: { selector: "#name" } }],
        [
          "rich-text",
          { op: "type", target: { selector: "#notes" }, text: "hi" },
        ],
        ["clipboard", { op: "click", target: { selector: "#copy" } }],
      ]
      for (const [gap, op] of cases) {
        const has = opts.gaps.includes(gap)
        it(`${has ? "names" : "has no"} the ${gap} gap`, async () => {
          const result = await run(op)
          if (has) {
            expect(result).toMatchObject({ status: "gap", gap })
            expect(DRIVE_GAPS[gap]).toBeTruthy()
          } else {
            expect(result.status).not.toBe("gap")
          }
        })
      }
    })

    describe("no script", () => {
      beforeEach(() => h.load(`<p id="out">idle</p>`))

      it("refuses any op outside the contract, and the page runs nothing", async () => {
        for (const op of ["eval", "evaluate", "script", "run", "exec"]) {
          const result = await run({
            op,
            script: "window.__evaluated = true",
            code: "window.__evaluated = true",
            expression: "window.__evaluated = true",
          })
          expect(result.status).toBe("failed")
        }
        expect(await h.evaluated()).toBe(false)
      })
    })

    describe("screenshot", () => {
      beforeEach(() => h.load(`<p>Hello</p>`))

      it("returns an image of the frame", async () => {
        const result = await h.backend.screenshot(h.frameId)
        expect(result.status).toBe("shot")
        if (result.status !== "shot") return
        expect(result.shot.mediaType).toMatch(/^image\//)
        expect(result.shot.data.length).toBeGreaterThan(0)
      })
    })
  })
}
