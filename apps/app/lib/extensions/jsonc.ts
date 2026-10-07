/**
 * Parse JSON with comments: `//` and `/* *\/` comments and trailing commas are
 * allowed, as in tsconfig.json and VS Code settings. Comments and trailing
 * commas become spaces, so positions in `JSON.parse` errors still point at
 * the original text.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text))
}

export function stripJsonc(text: string): string {
  const out = text.split("")
  let i = 0
  // Index of the last comma outside a string, until a value follows it.
  let pendingComma = -1
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) if (out[j] !== "\n") out[j] = " "
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      pendingComma = -1
      i++
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
      i++
    } else if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i)
      const stop = end === -1 ? text.length : end
      blank(i, stop)
      i = stop
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      const stop = end === -1 ? text.length : end + 2
      blank(i, stop)
      i = stop
    } else if (c === ",") {
      pendingComma = i
      i++
    } else if (c === "}" || c === "]") {
      if (pendingComma !== -1) out[pendingComma] = " "
      pendingComma = -1
      i++
    } else {
      if (!/\s/.test(c)) pendingComma = -1
      i++
    }
  }
  return out.join("")
}
