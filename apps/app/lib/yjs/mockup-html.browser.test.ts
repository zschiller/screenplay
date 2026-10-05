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
  // Every path the stand-in app's server was asked for.
  const requests: string[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(req.url ?? "")
      res.setHeader("Content-Type", "text/html")
      res.end("<!doctype html><body></body>")
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    browser = await chromium.launch({ executablePath: CHROME! })
    page = await browser.newPage()
    const { port } = server.address() as AddressInfo
    await page.goto(`http://127.0.0.1:${port}/`)
  })

  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  /** Run `html` as a Mockup and read back what its page reports. */
  async function run(html: string, resources: MockupResources) {
    const doc = mockupSrcDoc(html, "", resources)
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
  // The design templates' App Skill pages (#1646): a few KB of data that
  // load their runtime from the Skill with a `skill:` reference.
  const TEMPLATES = [
    ["screenplay-explore-with-mockups", "exploration-template.html"],
    ["screenplay-design-audit", "audit-template.html"],
    ["screenplay-design-audit", "decisions-template.html"],
    ["screenplay-design-storybook", "storybook-template.html"],
  ]

  it.each(TEMPLATES)(
    "renders the %s Skill's %s from its runtime",
    async (skill, path) => {
      const { html, resources } = templatePage(skill, path)
      expect(Object.values(resources)).not.toContain(null)
      const report = await run(
        `${html}<script>
          // React renders after load; report once the page has mounted
          var t = setInterval(function () {
            var app = document.getElementById("app")
            if (!app.childElementCount) return
            clearInterval(t)
            parent.postMessage({
              report: true,
              text: app.textContent.length > 0,
              font: getComputedStyle(document.documentElement).fontFamily,
              faces: Array.from(document.fonts, (f) => f.family).sort(),
            }, "*")
          }, 20)
        </script>`,
        resources
      )
      expect(report.text).toBe(true)
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
    const data = `<script>
      const PAGE={date:"4 Oct 2026",slug:"test",round:1,title:"Part",quote:"Show me.",where:""};
      const CONTROLS=[{key:"s",label:"Shape",values:["Wide","Tall","Square"]}];
      const STATES=[
        {id:"wide",name:"Wide",set:{s:"Wide"},shots:{p:"${shot(1280, 800)}"}},
        {id:"tall",name:"Tall",set:{s:"Tall"},shots:{p:"${shot(400, 900)}"}},
        {id:"square",name:"Square",set:{s:"Square"},shots:{p:"${shot(600, 600)}"}}
      ];
    </script>`
    const html = files
      .find((f) => f.path === "storybook-template.html")!
      .content.replace(/<script>\s*const IMG=[\s\S]*?<\/script>/, data)
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
      }
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

  // The exploration page on a canvas (#1647): its Pick answers the card the
  // chat asked about it, and Send to chat drafts the reaction, each from a
  // real click, as the canvas would get them.
  it("answers the chat's card from Pick and drafts from Send to chat", async () => {
    const { html, resources } = templatePage(
      "screenplay-explore-with-mockups",
      "exploration-template.html"
    )
    const doc = mockupSrcDoc(html, MOCKUP_RUNTIME_JS, resources)
    await page.evaluate((srcdoc) => {
      const w = window as unknown as { posted: unknown[] }
      w.posted = []
      const frame = document.createElement("iframe")
      frame.setAttribute("sandbox", "allow-scripts")
      frame.style.cssText = "width:1000px;height:800px"
      addEventListener("message", (e) => {
        const data = e.data
        if (e.source !== frame.contentWindow || !data?.type) return
        w.posted.push(data)
        // The canvas's side: the sample data's question, still open
        if (data.type === "screenplay:question-request")
          frame.contentWindow!.postMessage(
            {
              type: "screenplay:question-apply",
              question: {
                id: "call-1",
                question: "The first question",
                options: [
                  { label: "A: Short name" },
                  { label: "B: Short name" },
                ],
                recommended: 0,
                answer: null,
              },
            },
            "*"
          )
      })
      frame.srcdoc = srcdoc
      document.body.append(frame)
    }, doc)
    const frame = page.frameLocator("iframe")
    await frame.getByRole("radio", { name: /^B/ }).first().click()
    await frame.getByRole("button", { name: "Pick B" }).click()
    await frame.getByRole("button", { name: "Send to chat" }).click()
    const answersAndDrafts = async () =>
      (await page.evaluate(
        "window.posted.filter((m) => /answer|draft/.test(m.type))"
      )) as { type: string; text?: string }[]
    // The draft's message can land after the click resolves.
    await expect.poll(async () => (await answersAndDrafts()).length).toBe(2)
    const posted = await answersAndDrafts()
    expect(posted[0]).toEqual({
      type: "screenplay:question-answer",
      id: "call-1",
      index: 1,
    })
    expect(posted[1]!.type).toBe("screenplay:draft")
    expect(posted[1]!.text).toContain("→ The first question: B: Short name")
    await page.evaluate("document.querySelector('iframe').remove()")
  })
})

/** An App Skill's template page and the Skill files its references name. */
function templatePage(skill: string, path: string) {
  const files = appSkills.open(skill)!.files
  const html = files.find((f) => f.path === path)!.content
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
  return { html, resources }
}
