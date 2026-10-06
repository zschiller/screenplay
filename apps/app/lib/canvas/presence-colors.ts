/**
 * The colours people get on a Canvas: their cursor, name tag, cursor chat,
 * avatar and selection outline. Signal fills (packages/ui tokens.css), each
 * behind black ink. Hex, not oklch, so `presenceInk` can read them and every
 * peer's renderer (canvas 2D strokes, y-prosemirror carets) takes them as is.
 *
 * Hues that already mean something on the canvas stay out: pink is your own
 * selection, yellow comments, violet inspect, red snap.
 */
export const PRESENCE_COLORS = [
  "#FF8506", // orange
  "#10EB62", // green
  "#49A9FF", // blue
  "#1EE4F6", // cyan
  "#C0F447", // lime
  "#C4A4FE", // lavender
] as const

/** A colour for this session, picked at random. */
export function pickPresenceColor(random: () => number = Math.random): string {
  return PRESENCE_COLORS[Math.floor(random() * PRESENCE_COLORS.length)]!
}
