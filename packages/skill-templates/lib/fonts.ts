// The app's three faces as a stylesheet with the fonts inlined, for pages
// shown as a Mockup, which loads nothing from the network (font-src data:
// only). Latin subsets from Google Fonts, all under the SIL Open Font
// License: Instrument Sans, Unbounded and Geist Mono (see fonts/README.md).

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL("../fonts/", import.meta.url))

// Google Fonts' latin range
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

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
      const data = readFileSync(`${dir}${file}.woff2`).toString("base64")
      return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};${stretch ? `font-stretch:${stretch};` : ""}font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${LATIN}}`
    }).join("\n") + "\n"
  )
}
