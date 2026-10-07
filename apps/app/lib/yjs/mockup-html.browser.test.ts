import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { mediaTypeFor } from "@/lib/files/paths"
import {
  mockupRefs,
  parseMockupRef,
  type MockupResources,
} from "@/lib/mockup-refs"
import { MOCKUP_RUNTIME_JS } from "@/lib/sandbox-bridge"
import { appSkills } from "@/lib/skills"
import { mockupSrcDoc } from "./mockup-html"

// A Mockup page with `skill:` and `files:` references (#1643), built by
// `mockupSrcDoc` and run in a real Chrome the way the canvas runs it: an
// `<iframe srcdoc>` sandboxed to `allow-scripts`, in an opaque origin.
// Skipped where no Chrome is installed; CI's browser job has one.

function which(cmd: string): string | null {
  try {
    return (
      execFileSync("sh", ["-c", `command -v ${cmd}`])
        .toString()
        .trim() || null
    )
  } catch {
    return null
  }
}

const CHROME =
  process.env.CHROME ??
  which("google-chrome") ??
  which("chromium") ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null)
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !CHROME) {
  throw new Error("Chrome is required but wasn't found")
}

const b64 = (s: string) => Buffer.from(s).toString("base64")

// What the stand-in app's server serves for Mockup folders (#1889), by path:
// each template page's `data.js`, and any capture under a folder as a grey
// picture.
const served = new Map<string, string>()
let origin = ""
const CAPTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="#888"/></svg>`

const RESOURCES: MockupResources = {
  "skill:explore/runtime.js": {
    type: "text/javascript",
    data: b64("window.order = (window.order || []).concat('runtime')"),
  },
  "skill:explore/runtime.css": {
    type: "text/css",
    data: b64("body { color: rgb(1, 2, 3) }"),
  },
  "files:shots/home.png": {
    type: "image/svg+xml",
    data: b64(
      '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"></svg>'
    ),
  },
  "files:gone.png": null,
}

describe.skipIf(!CHROME)("a Mockup page with references", () => {
  let browser: Browser
  let page: Page
  let server: http.Server
  // Every path the stand-in app's server was asked for, but the favicon:
  // Chrome fetches that for the page itself, whenever it gets to it, so it
  // can land after a test clears the list.
  const requests: string[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url !== "/favicon.ico") requests.push(req.url ?? "")
      const url = req.url ?? ""
      const file = served.get(url)
      if (file !== undefined) {
        res.setHeader("Content-Type", "text/javascript")
        res.end(file)
        return
      }
      if (url.startsWith("/mockups/") && /\.(png|webp|jpe?g)$/.test(url)) {
        res.setHeader("Content-Type", "image/svg+xml")
        res.end(CAPTURE)
        return
      }
      res.setHeader("Content-Type", "text/html")
      res.end("<!doctype html><body></body>")
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    browser = await chromium.launch({ executablePath: CHROME! })
    page = await browser.newPage()
    const { port } = server.address() as AddressInfo
    origin = `http://127.0.0.1:${port}`
    await page.goto(`${origin}/`)
  })

  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  /** Run `html` as a Mockup and read back what its page reports. */
  async function run(html: string, resources: MockupResources, base?: string) {
    const doc = mockupSrcDoc(html, "", resources, base)
    return page.evaluate(
      (srcdoc) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const frame = document.createElement("iframe")
          frame.setAttribute("sandbox", "allow-scripts")
          const onMessage = (e: MessageEvent) => {
            // Only the page's report, not what its scripts tell the canvas
            if (e.source !== frame.contentWindow || !e.data?.report) return
            window.removeEventListener("message", onMessage)
            frame.remove()
            resolve(e.data as Record<string, unknown>)
          }
          window.addEventListener("message", onMessage)
          setTimeout(() => reject(new Error("The page didn't report")), 5000)
          frame.srcdoc = srcdoc
          document.body.append(frame)
        }),
      doc
    )
  }

  // Reports after load: the order its scripts ran in, the stylesheet's
  // colour, each image's size, and its root attributes.
  const REPORT = `<script>
    addEventListener("load", () => parent.postMessage({
      report: true,
      order: window.order,
      color: getComputedStyle(document.body).color,
      images: Array.from(document.images, (i) => i.naturalWidth),
      lang: document.documentElement.lang,
      bodyClass: document.body.className,
      srcs: Array.from(document.querySelectorAll("[src],[href]"), (e) => (e.getAttribute("src") || e.getAttribute("href")).split(":")[0]),
    }, "*"))
  </script>`

  it("resolves skill: and files: references inside the page's own origin", async () => {
    const report = await run(
      `<!doctype html><html lang="en"><head>
        <link rel="stylesheet" href="skill:explore/runtime.css">
        <script src="skill:explore/runtime.js"></script>
        <script>window.order = window.order.concat("page")</script>
        ${REPORT}
      </head><body class="pick">
        <img src="files:shots/home.png">
      </body></html>`,
      RESOURCES
    )
    expect(report).toEqual({
      report: true,
      order: ["runtime", "page"],
      color: "rgb(1, 2, 3)",
      images: [7],
      lang: "en",
      bodyClass: "pick",
      srcs: ["blob", "blob", "blob"],
    })
  })

  it("renders a reference that didn't resolve empty, and the rest still runs", async () => {
    const report = await run(
      `<script src="files:gone.png"></script>
       <script src="skill:explore/missing.js"></script>
       <script>window.order = ["page"]</script>
       ${REPORT}
       <img src="files:gone.png"><img src="files:shots/home.png">`,
      RESOURCES
    )
    expect(report.order).toEqual(["page"])
    expect(report.images).toEqual([0, 7])
  })

  it("still loads nothing from the network", async () => {
    const { port } = server.address() as AddressInfo
    requests.length = 0
    const report = await run(
      `<script src="http://127.0.0.1:${port}/x.js"></script>
       <link rel="stylesheet" href="http://127.0.0.1:${port}/x.css">
       <img src="http://127.0.0.1:${port}/x.png">
       <img src="files:shots/home.png">
       ${REPORT}`,
      RESOURCES
    )
    expect(report.images).toEqual([0, 7])
    expect(requests).toEqual([])
  })
  // The design templates' App Skill pages (#1646): a few KB that load their
  // runtime from the Skill with a `skill:` reference, and their data and
  // captures from the Mockup's folder (#1889).
  const TEMPLATES = [
    ["screenplay-design-exploration", "exploration-template.html"],
    ["screenplay-design-audit", "audit-template.html"],
    ["screenplay-design-audit", "decisions-template.html"],
    ["screenplay-design-storybook", "storybook-template.html"],
  ]

  it.each(TEMPLATES)(
    "renders the %s Skill's %s from its runtime",
    async (skill, path) => {
      const { html, resources, base } = templatePage(skill, path)
      expect(Object.values(resources)).not.toContain(null)
      // Two references, whatever the data holds: no capture list
      expect(Object.keys(resources)).toHaveLength(2)
      const report = await run(
        `${html}<script>
          // React renders after load; report once the page has mounted and
          // its first captures have loaded
          var t = setInterval(function () {
            var app = document.getElementById("app")
            if (!app.childElementCount) return
            var shots = Array.from(document.images, function (i) {
              return i.complete ? i.naturalWidth : -1
            })
            if (shots.length && shots.every(function (w) { return w < 0 })) return
            clearInterval(t)
            parent.postMessage({
              report: true,
              text: app.textContent.length > 0,
              shots: shots.filter(function (w) { return w >= 0 }),
              font: getComputedStyle(document.documentElement).fontFamily,
              faces: Array.from(document.fonts, (f) => f.family).sort(),
            }, "*")
          }, 20)
        </script>`,
        resources,
        base
      )
      expect(report.text).toBe(true)
      // Every capture the page shows loaded from its folder
      expect(report.shots).not.toContain(0)
      // The runtime's styles: the page's font comes from its token block,
      // and the faces from the Skill's fonts.css, as nothing loads from the
      // network
      expect(report.font).toContain("Instrument Sans")
      expect(report.faces).toEqual(
        expect.arrayContaining(["Geist Mono", "Instrument Sans", "Unbounded"])
      )
    }
  )

  // The storybook page as a Mockup (#1649): its notes go to the chat's
  // composer through `screenplay.draft`, and the controls hold still while
  // you step through states whose captures have different shapes.
  it("sends a storybook's notes to the chat and keeps its controls still", async () => {
    const skill = "screenplay-design-storybook"
    const files = appSkills.open(skill)!.files
    const shot = (w: number, h: number) =>
      "data:image/svg+xml;base64," +
      b64(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#888"/></svg>`
      )
    const data = `
      const PAGE={date:"4 Oct 2026",slug:"test",round:1,title:"Part",quote:"Show me.",where:""};
      const CONTROLS=[{key:"s",label:"Shape",values:["Wide","Tall","Square"]}];
      const STATES=[
        {id:"wide",name:"Wide",set:{s:"Wide"},shots:{p:"${shot(1280, 800)}"}},
        {id:"tall",name:"Tall",set:{s:"Tall"},shots:{p:"${shot(400, 900)}"}},
        {id:"square",name:"Square",set:{s:"Square"},shots:{p:"${shot(600, 600)}"}}
      ];`
    const html = files.find(
      (f) => f.path === "storybook-template.html"
    )!.content
    const base = serveFolder("storybook-notes", data)
    const runtime = files.find((f) => f.path === "storybook-runtime.js")!
    const doc = mockupSrcDoc(
      html,
      readFileSync(
        join(process.cwd(), "lib", "sandbox-bridge", "mockup-chat.js"),
        "utf8"
      ),
      {
        [`skill:${skill}/storybook-runtime.js`]: {
          type: "text/javascript",
          data: b64(runtime.content),
        },
      },
      base
    )
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.evaluate((srcdoc) => {
      const w = window as unknown as { drafts: unknown[] }
      w.drafts = []
      window.addEventListener("message", (e) => {
        if (e.data?.type === "screenplay:draft") w.drafts.push(e.data.text)
      })
      const frame = document.createElement("iframe")
      frame.setAttribute("sandbox", "allow-scripts")
      frame.style.cssText = "width:1280px;height:800px;border:0"
      frame.srcdoc = srcdoc
      document.body.append(frame)
    }, doc)
    const mockup = page.frameLocator("iframe")
    const send = mockup.getByRole("button", { name: "Send to chat" })
    await send.waitFor({ timeout: 10_000 })
    // As an Artifact the same button copies; in a Mockup it sends
    expect(
      await mockup.getByRole("button", { name: "Copy notes" }).count()
    ).toBe(0)

    const controls = mockup.getByRole("radiogroup", { name: "Shape" })
    const name = mockup.getByRole("heading", { level: 2 })
    const tops: number[] = []
    for (const state of ["Wide", "Tall", "Square"]) {
      await expect.poll(() => name.textContent()).toBe(state)
      tops.push((await controls.boundingBox())!.y)
      // The state's name is on the first screen, above the bottom bar
      const bar = (await send.boundingBox())!.y
      expect((await name.boundingBox())!.y).toBeLessThan(bar)
      await mockup.getByRole("button", { name: "Next state" }).click()
    }
    expect(new Set(tops).size).toBe(1)

    await mockup
      .getByRole("textbox", { name: "Note on this state" })
      .fill("Too dense")
    await send.click()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { drafts: unknown[] }).drafts)
      )
      .toEqual(["Storybook: Part\n→ Wide (Shape Wide): Too dense"])
    await page.evaluate("document.querySelector('iframe').remove()")
  }, 20_000)

  /**
   * Run an App Skill's template page as a Mockup whose chat has `question`
   * open about it, as the canvas tells the page, and record everything the
   * page posts to the canvas.
   */
  async function onCanvas(
    skill: string,
    path: string,
    question: Record<string, unknown>
  ) {
    const { html, resources, base } = templatePage(skill, path)
    const doc = mockupSrcDoc(html, MOCKUP_RUNTIME_JS, resources, base)
    await page.evaluate(
      ([srcdoc, question]) => {
        const w = window as unknown as { posted: unknown[] }
        w.posted = []
        const frame = document.createElement("iframe")
        frame.setAttribute("sandbox", "allow-scripts")
        frame.style.cssText = "width:1000px;height:800px"
        addEventListener("message", (e) => {
          const data = e.data
          if (e.source !== frame.contentWindow || !data?.type) return
          w.posted.push(data)
          // The canvas's side: the question, still open
          if (data.type === "screenplay:question-request")
            frame.contentWindow!.postMessage(
              { type: "screenplay:question-apply", question },
              "*"
            )
        })
        frame.srcdoc = srcdoc as string
        document.body.append(frame)
      },
      [doc, { recommended: 0, answer: null, answerable: true, ...question }]
    )
    return page.frameLocator("iframe")
  }

  const answersAndDrafts = async () =>
    (await page.evaluate(
      "window.posted.filter((m) => /answer|draft/.test(m.type))"
    )) as { type: string; text?: string }[]

  // Each page on a canvas: a pick waits on the page, even on the question
  // the chat's card asks, until Send to chat drafts every pick at once in
  // Copy's format, from a real click, as the canvas would get it.
  it.each([
    {
      template: "exploration",
      skill: "screenplay-design-exploration",
      path: "exploration-template.html",
      question: {
        question: "The first question",
        options: [{ label: "A: Short name" }, { label: "B: Short name" }],
      },
      picks: [/^B · /, /^Looks good/],
      draft:
        "Round 2\n→ The first question: B: Short name\n→ Combined: Looks good",
    },
    {
      template: "audit",
      skill: "screenplay-design-audit",
      path: "audit-template.html",
      question: {
        question: "H1: The question in one line?",
        options: [{ label: "Option A" }, { label: "Option B" }],
      },
      picks: [/^B · Option B/],
      draft: "Calls:\n  H1 → B: Option B",
    },
    {
      template: "decisions",
      skill: "screenplay-design-audit",
      path: "decisions-template.html",
      question: {
        question: "H1: Should the figures sell versions of one change?",
        options: [{ label: "Versions" }, { label: "Parallel tasks" }],
      },
      picks: [/^Parallel tasks/],
      draft:
        "H1. Should the figures sell versions of one change, or parallel tasks?\n   → Parallel tasks",
    },
  ])(
    "keeps the $template page’s picks until Send to chat drafts them all",
    async ({ skill, path, question, picks, draft }) => {
      const frame = await onCanvas(skill, path, { id: "call-1", ...question })
      for (const name of picks) {
        const radio = frame.getByRole("radio", { name }).first()
        await radio.click()
        await expect.poll(() => radio.isChecked()).toBe(true)
      }
      // Nothing reaches the chat before Send, not even the card's question
      await new Promise((r) => setTimeout(r, 300))
      expect(await answersAndDrafts()).toEqual([])

      await frame.getByRole("button", { name: "Send to chat" }).click()
      // The draft's message can land after the click resolves.
      await expect.poll(async () => (await answersAndDrafts()).length).toBe(1)
      const [posted] = await answersAndDrafts()
      expect(posted!.type).toBe("screenplay:draft")
      expect(posted!.text).toContain(draft)
      await page.evaluate("document.querySelector('iframe').remove()")
    },
    20_000
  )

  // While the page can't reach the chat (a live page nobody has control of,
  // or the agent drives it), a pick stays on the page, which says to answer
  // in the chat.
  it("keeps the pick on the page while it can't reach the chat", async () => {
    const frame = await onCanvas(
      "screenplay-design-exploration",
      "exploration-template.html",
      {
        id: "call-1",
        question: "The first question",
        options: [{ label: "A: Short name" }, { label: "B: Short name" }],
        answerable: false,
      }
    )
    const b = frame.getByRole("radio", { name: /^B · / }).first()
    await b.click()
    await expect.poll(() => b.isChecked()).toBe(true)
    await frame
      .getByText("Answer in the chat")
      .filter({ visible: true })
      .waitFor()
    expect(await answersAndDrafts()).toEqual([])
    await page.evaluate("document.querySelector('iframe').remove()")
  }, 20_000)
})

/**
 * Serve `data` as a Mockup folder's `data.js` (#1889), and any capture under
 * it; the folder's base, as its page gets it.
 */
function serveFolder(name: string, data: string) {
  served.set(`/mockups/${name}/r1/data.js`, data)
  return `${origin}/mockups/${name}/r1/`
}

/**
 * An App Skill's template page as a Mockup folder's index.html, the Skill
 * files its references name, and the base of the folder that serves its
 * sample data as `data.js`.
 */
function templatePage(skill: string, path: string) {
  const files = appSkills.open(skill)!.files
  const html = files.find((f) => f.path === path)!.content
  const data = files.find(
    (f) => f.path === path.replace("-template.html", "-data.js")
  )!.content
  const base = serveFolder(path.replace("-template.html", ""), data)
  const resources: Record<string, MockupResources[string]> = {}
  for (const ref of mockupRefs(html)) {
    const parsed = parseMockupRef(ref)
    const file =
      parsed?.kind === "skill" && parsed.skill === skill
        ? files.find((f) => f.path === parsed.path)
        : undefined
    resources[ref] = file
      ? { type: mediaTypeFor(file.path, "text/plain"), data: b64(file.content) }
      : null
  }
  return { html, resources, base }
}
