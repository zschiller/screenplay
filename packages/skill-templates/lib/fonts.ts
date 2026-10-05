// The app's faces for the App Skill pages: a Mockup loads nothing from the
// network, so the Google Fonts link the repo skills' pages carry would leave
// a canvas on the system fonts. `fontsCss` is a stylesheet with the Latin
// files (fonts/) as data URLs, which the Mockup's CSP allows; each App
// Skill holds it once, and its data pages link it by a `skill:` reference.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const FACES = [
  {
    family: "Instrument Sans",
    file: "instrument-sans-latin",
    weight: "400 700",
    stretch: "75% 100%",
  },
  { family: "Unbounded", file: "unbounded-latin", weight: "400" },
  { family: "Geist Mono", file: "geist-mono-latin", weight: "400 600" },
]

export function fontsCss() {
  return (
    FACES.map(({ family, file, weight, stretch }) => {
      const data = readFileSync(
        fileURLToPath(new URL(`../fonts/${file}.woff2`, import.meta.url))
      ).toString("base64")
      return [
        `@font-face{font-family:"${family}"`,
        `font-style:normal`,
        `font-weight:${weight}`,
        ...(stretch ? [`font-stretch:${stretch}`] : []),
        `font-display:swap`,
        `src:url(data:font/woff2;base64,${data}) format("woff2")}`,
      ].join(";")
    }).join("\n") + "\n"
  )
}
