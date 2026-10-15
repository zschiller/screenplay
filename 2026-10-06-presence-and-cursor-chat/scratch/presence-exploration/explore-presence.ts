// EXPLORATION ONLY (never committed): variant switch for the presence design pass.
export function explore(q: "q1" | "q2" | "q3"): string {
  if (typeof window === "undefined") return "t"
  try {
    const v = window.localStorage.getItem("explorePresence") ?? ""
    const m = new RegExp(`${q}=(\\w)`).exec(v)
    return m ? m[1]! : "t"
  } catch {
    return "t"
  }
}
export function exploreSelfColor(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem("explorePresenceSelf")
  } catch {
    return null
  }
}
