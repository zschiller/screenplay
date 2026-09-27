/**
 * Text colour for a label painted on a presence colour (issue #719).
 *
 * Presence colours are picked from a palette of mid-to-light swatches, so white
 * text — the old default — falls below 2:1 on most of them. This picks
 * whichever of white or near-black ink has the higher WCAG contrast against the
 * swatch. Returns `"light"` (white ink) for anything it can't parse, matching
 * the previous behaviour.
 */
export type PresenceInk = "light" | "dark"

/** Tailwind text classes for each ink, so call sites stay free of literals. */
export const PRESENCE_INK_CLASS: Record<PresenceInk, string> = {
  light: "text-white",
  dark: "text-neutral-950",
}

// neutral-950 (oklch(0.145 0 0)) is ~#0a0a0a; its luminance is what dark ink
// is measured with.
const DARK_INK_LUMINANCE = relativeLuminance([10, 10, 10])

export function presenceInk(color: string): PresenceInk {
  const rgb = parseColor(color)
  if (!rgb) return "light"
  const bg = relativeLuminance(rgb)
  const onWhite = contrast(1, bg)
  const onDark = contrast(bg, DARK_INK_LUMINANCE)
  return onDark > onWhite ? "dark" : "light"
}

export function presenceInkClass(color: string): string {
  return PRESENCE_INK_CLASS[presenceInk(color)]
}

function parseColor(color: string): [number, number, number] | null {
  const value = color.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)
  if (hex) {
    const digits = hex[1]!
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((d) => d + d)
            .join("")
        : digits
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(lighter: number, darker: number): number {
  return (lighter + 0.05) / (darker + 0.05)
}
