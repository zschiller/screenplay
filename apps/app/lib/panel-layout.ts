export type PanelLayout = { [panelId: string]: number }

const COOKIE_PREFIX = "panel_layout"
const MAX_AGE = 60 * 60 * 24 * 365

export function panelLayoutCookieName(groupId: string): string {
  return `${COOKIE_PREFIX}:${groupId}`
}

export function parsePanelLayoutValue(
  rawValue: string | undefined
): PanelLayout | undefined {
  if (!rawValue) return undefined
  try {
    const decoded = decodeURIComponent(rawValue)
    const parsed: unknown = JSON.parse(decoded)
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed as Record<string, unknown>).every(
        (v) => typeof v === "number" && Number.isFinite(v)
      )
    ) {
      return parsed as PanelLayout
    }
  } catch {}
  return undefined
}

export function writePanelLayout(groupId: string, layout: PanelLayout): void {
  if (typeof document === "undefined") return
  const value = encodeURIComponent(JSON.stringify(layout))
  document.cookie = `${panelLayoutCookieName(groupId)}=${value}; path=/; max-age=${MAX_AGE}; samesite=lax`
}
