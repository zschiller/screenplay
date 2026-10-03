import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { DriveResult } from "@/lib/frame-drive/contract"
import type { FrameDriveHarness } from "@/lib/frame-drive/contract-suite"

/**
 * A jsdom test page running the Sandbox Bridge, as a frame or mockup runs it,
 * for the backends' contract suites (`mac/`, `view/`). Test-only.
 */

const BRIDGE = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "bridge.js"),
  "utf8"
)

/** A 1×1 PNG, standing in for a screenshot. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
)

/** Start the bridge in this page, with the layout jsdom lacks faked. */
export function startTestPage(): void {
  fakeLayout()
  new Function(BRIDGE)()
}

/** Send the bridge one message, as the canvas does, and resolve its answer. */
let nextId = 1
export function askBridge<T = DriveResult>(
  message: Record<string, unknown>
): Promise<T> {
  const id = `d${nextId++}`
  return new Promise((resolve) => {
    function onMessage(e: MessageEvent) {
      const d = e.data
      if (d?.type !== "screenplay:dom-result" || d.id !== id) return
      window.removeEventListener("message", onMessage)
      resolve(d.ok ? d.value : { status: "failed", reason: d.error })
    }
    window.addEventListener("message", onMessage)
    window.dispatchEvent(
      new MessageEvent("message", { data: { ...message, id }, source: window })
    )
  })
}

/** The page half of a {@link FrameDriveHarness}. */
export const testPage: Pick<FrameDriveHarness, "load" | "evaluated"> = {
  async load(html) {
    document.body.innerHTML = html
    for (const script of document.body.querySelectorAll("script")) {
      new Function(script.textContent ?? "")()
    }
  },
  async evaluated() {
    return (window as { __evaluated?: boolean }).__evaluated === true
  },
}

/** jsdom has no layout: give every shown element a box, and no hit-testing. */
function fakeLayout() {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } }
  g.CSS ??= {}
  g.CSS.escape ??= (s: string) => s.replace(/["\\]/g, "\\$&")
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const shown = !this.closest("[hidden]")
    const box = shown ? { width: 100, height: 20 } : { width: 0, height: 0 }
    return {
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 10 + box.width,
      bottom: 10 + box.height,
      ...box,
      toJSON() {},
    } as DOMRect
  }
  document.elementFromPoint = () => null
  window.scrollBy = () => {}
  // WebKit refuses the clipboard to an untrusted gesture in a frame.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () =>
        Promise.reject(new DOMException("denied", "NotAllowedError")),
    },
  })
}
