/**
 * The one **ANSI palette** the app paints terminal output with — shared by the
 * xterm terminal tab and the sandbox logs panel, so a line reads the same colour
 * in both, in both themes.
 *
 * The stock 16 colours (xterm's, anser's) are tuned for black: on the light
 * theme's white, yellow, white and the bright cyan/green/yellow wash out to near
 * invisible. These are picked per theme instead, from the Tailwind scales the
 * rest of the UI uses, so every one of the 16 clears WCAG AA (4.5:1) against its
 * theme's background (`ansi-palette.test.ts` holds them to that). In the light
 * theme the "bright" row is the *stronger* shade rather than the paler one —
 * bright text is emphasis, and paler-on-white would read as disabled.
 */

/** xterm's `ITheme` key for each of the 16 colours, in SGR order (30–37, 90–97). */
export const ANSI_COLOR_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const

export type AnsiColorKey = (typeof ANSI_COLOR_KEYS)[number]
export type AnsiMode = "light" | "dark"

/**
 * The palette, as hex (xterm's colour parser takes hex; the theme tokens are
 * `oklch`). Indexed like {@link ANSI_COLOR_KEYS}.
 */
export const ANSI_PALETTE: Record<AnsiMode, readonly string[]> = {
  light: [
    "#262626", // black — neutral-800
    "#dc2626", // red — red-600
    "#047857", // green — emerald-700
    "#b45309", // yellow — amber-700
    "#2563eb", // blue — blue-600
    "#c026d3", // magenta — fuchsia-600
    "#0e7490", // cyan — cyan-700
    "#525252", // white — neutral-600
    "#737373", // bright black — neutral-500
    "#b91c1c", // bright red — red-700
    "#15803d", // bright green — green-700
    "#a16207", // bright yellow — yellow-700
    "#1d4ed8", // bright blue — blue-700
    "#a21caf", // bright magenta — fuchsia-700
    "#155e75", // bright cyan — cyan-800
    "#171717", // bright white — neutral-900
  ],
  dark: [
    "#808080", // black — lifted off the background so it stays legible
    "#f87171", // red — red-400
    "#34d399", // green — emerald-400
    "#fbbf24", // yellow — amber-400
    "#60a5fa", // blue — blue-400
    "#e879f9", // magenta — fuchsia-400
    "#22d3ee", // cyan — cyan-400
    "#d4d4d4", // white — neutral-300
    "#a3a3a3", // bright black — neutral-400
    "#fca5a5", // bright red — red-300
    "#6ee7b7", // bright green — emerald-300
    "#fcd34d", // bright yellow — amber-300
    "#93c5fd", // bright blue — blue-300
    "#f0abfc", // bright magenta — fuchsia-300
    "#67e8f9", // bright cyan — cyan-300
    "#fafafa", // bright white — neutral-50
  ],
}

/** Font size (px) of terminal-style output — the terminal tab and the logs panel. */
export const TERMINAL_FONT_SIZE = 12

/** The palette as an xterm `ITheme` fragment, for `term.options.theme`. */
export function xtermAnsiTheme(mode: AnsiMode): Record<AnsiColorKey, string> {
  const colors = ANSI_PALETTE[mode]
  return Object.fromEntries(
    ANSI_COLOR_KEYS.map((key, i) => [key, colors[i]!])
  ) as Record<AnsiColorKey, string>
}

/** The CSS variable carrying ANSI colour `index` (0–15) for the current theme. */
export function ansiColorVar(index: number): string {
  return `var(--ansi-${index})`
}

/**
 * The palette as CSS custom properties — light on `:root`, dark under `.dark`
 * (the class `next-themes` toggles) — so DOM-rendered output follows a theme
 * switch with no re-render. Read through {@link ansiColorVar}.
 */
export const ANSI_PALETTE_CSS = [
  `:root{${cssVars(ANSI_PALETTE.light)}}`,
  `.dark{${cssVars(ANSI_PALETTE.dark)}}`,
].join("")

function cssVars(colors: readonly string[]): string {
  return colors.map((c, i) => `--ansi-${i}:${c};`).join("")
}

/**
 * Map one of anser's `use_classes` colour names to its palette index:
 * `ansi-red` → 1, `ansi-bright-red` → 9, and `ansi-palette-N` for N < 16 (a
 * 256-colour escape naming one of the base 16). `null` for anything else — a
 * 256-colour index past 15 or a truecolour, which carry their own RGB.
 */
export function ansiClassIndex(cls: string): number | null {
  const palette = /^ansi-palette-(\d+)$/.exec(cls)
  if (palette) {
    const n = Number(palette[1])
    return n < 16 ? n : null
  }
  const named = /^ansi-(bright-)?([a-z]+)$/.exec(cls)
  if (!named) return null
  const base = ANSI_COLOR_KEYS.indexOf(named[2] as AnsiColorKey)
  if (base < 0 || base > 7) return null
  return named[1] ? base + 8 : base
}

/**
 * The fixed RGB of a 256-colour index past the base 16: the 6×6×6 cube
 * (16–231) and the grey ramp (232–255), as xterm defines them.
 */
export function xterm256Rgb(index: number): [number, number, number] {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10
    return [level, level, level]
  }
  const n = index - 16
  const step = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  return [step(Math.floor(n / 36)), step(Math.floor(n / 6) % 6), step(n % 6)]
}
