/*
 * The docs' diagram kit. Every diagram in `content/` is a hand-placed SVG
 * built from these pieces, so they share one grid, one set of sizes and one
 * stylesheet (`diagram.module.css`), and follow the docs theme.
 *
 * - Lay boxes out with `box()`, on the 4px grid (a dev warning names any
 *   coordinate that isn't), using the `SIZE` presets for heights.
 * - Connect them with `<Edge>` through the box anchors (`b.left`, `b.top`,
 *   …), so lines always meet a box exactly at its edge or centre.
 * - Put the words in the pieces' props, never in raw `<text>`, so the type
 *   stays on the scale below.
 *
 * Draw on a canvas 672 wide, the article column, so the diagram shows at
 * its drawn size; narrower screens scroll it rather than shrink the text.
 */
import styles from "./diagram.module.css"

export const GRID = 4

/** Box heights: one line, title + subtitle. Taller boxes hold other pieces. */
export const SIZE = { row: 40, pair: 56 } as const

/** Horizontal padding inside a box, and the gap to a note beside it. */
export const PAD = 16

type Point = readonly [number, number]

export type Box = {
  x: number
  y: number
  w: number
  h: number
  left: Point
  right: Point
  top: Point
  bottom: Point
  /** A point on the left or right edge at height `y`, for rows in tall boxes. */
  leftAt: (y: number) => Point
  rightAt: (y: number) => Point
}

function checkGrid(what: string, values: number[]) {
  if (process.env.NODE_ENV === "production") return
  const off = values.filter((v) => v % GRID !== 0)
  if (off.length > 0) {
    console.warn(
      `Diagram: ${what} is off the ${GRID}px grid (${off.join(", ")})`
    )
  }
}

export function box(x: number, y: number, w: number, h: number): Box {
  checkGrid(`box(${x}, ${y}, ${w}, ${h})`, [x, y, w, h])
  const cx = x + w / 2
  const cy = y + h / 2
  return {
    x,
    y,
    w,
    h,
    left: [x, cy],
    right: [x + w, cy],
    top: [cx, y],
    bottom: [cx, y + h],
    leftAt: (at) => [x, at],
    rightAt: (at) => [x + w, at],
  }
}

export function Diagram({
  width,
  height,
  label,
  children,
}: {
  width: number
  height: number
  /** What the diagram shows, for screen readers. */
  label: string
  children: React.ReactNode
}) {
  checkGrid(`Diagram ${width}×${height}`, [width, height])
  return (
    <figure className={styles.figure}>
      <div className={`${styles.scroll} nextra-scrollbar`}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={label}
        >
          {children}
        </svg>
      </div>
    </figure>
  )
}

type Tone =
  /** An outlined node. */
  | "node"
  /** The node the diagram is about, outlined in the accent. */
  | "hub"
  /** A hairline region that holds other pieces. */
  | "group"
  /** A node that stands for many: two copies peek out behind it. */
  | "stack"

export function Node({
  b,
  title,
  sub,
  tone = "node",
  mono = false,
  heading = false,
}: {
  b: Box
  title: string
  /** A muted second line under the title. */
  sub?: string
  tone?: Tone
  /** Set the title in the mono face, for paths and file names. */
  mono?: boolean
  /** Set the title as a heading, for the outermost region. */
  heading?: boolean
}) {
  const { x, y, w, h } = b
  // One line sits on the box's centre; a title + subtitle pair is centred as
  // a block; in a taller box that holds other pieces, the title sits at the top.
  const titleY = sub
    ? h > SIZE.pair
      ? y + 24
      : y + h / 2 - 4
    : h > SIZE.pair
      ? y + 25
      : y + h / 2 + 5
  const rect = (dx: number, className: string) => (
    <rect
      className={className}
      x={x + dx + 0.5}
      y={y + dx + 0.5}
      width={w - 1}
      height={h - 1}
      rx={2}
    />
  )
  return (
    <g>
      {tone === "stack" && (
        <>
          {rect(8, styles.back!)}
          {rect(4, styles.back!)}
        </>
      )}
      {rect(
        0,
        tone === "hub"
          ? styles.hub!
          : tone === "group"
            ? styles.group!
            : styles.node!
      )}
      <text
        className={heading ? styles.heading : mono ? styles.mono : styles.title}
        x={x + PAD}
        y={titleY}
      >
        {title}
      </text>
      {sub && (
        <text className={styles.sub} x={x + PAD} y={titleY + 18}>
          {sub}
        </text>
      )}
    </g>
  )
}

/** A small mono tag, for the parts inside a node. */
export function Chip({ b, text }: { b: Box; text: string }) {
  return (
    <g>
      <rect
        className={styles.chip}
        x={b.x + 0.5}
        y={b.y + 0.5}
        width={b.w - 1}
        height={b.h - 1}
        rx={2}
      />
      <text
        className={styles.chipText}
        x={b.x + b.w / 2}
        y={b.y + b.h / 2 + 3.5}
        textAnchor="middle"
      >
        {text}
      </text>
    </g>
  )
}

/**
 * Muted text beside a node: `PAD` right of it, on its centre line (or on the
 * centre line of its first row, for a tall node).
 */
export function Note({
  of,
  text,
  x,
  y,
  mono = false,
}: {
  of?: Box
  text: string
  /** Where it starts, to line several notes up in one column. */
  x?: number
  /** The centre line it sits on. */
  y?: number
  mono?: boolean
}) {
  return (
    <text
      className={mono ? styles.noteMono : styles.note}
      x={x ?? (of ? of.x + of.w + PAD : 0)}
      y={(y ?? (of ? of.y + Math.min(of.h, SIZE.row) / 2 : 0)) + 4.5}
    >
      {text}
    </text>
  )
}

/** A mono uppercase caption: a group's name, or a connector's. */
export function Label({
  x,
  y,
  text,
  anchor = "start",
}: {
  x: number
  y: number
  text: string
  anchor?: "start" | "middle"
}) {
  return (
    <text className={styles.label} x={x} y={y} textAnchor={anchor}>
      {text}
    </text>
  )
}

/** An arrowhead with its tip on `tip`, pointing away from `from`. */
function Head({ tip, from }: { tip: Point; from: Point }) {
  const [x, y] = tip
  const angle = Math.atan2(y - from[1], x - from[0])
  const back = (dx: number, dy: number) =>
    `${x + Math.cos(angle) * dx - Math.sin(angle) * dy} ${y + Math.sin(angle) * dx + Math.cos(angle) * dy}`
  return (
    <path
      className={styles.arrow}
      d={`M${x} ${y}L${back(-7, -3.5)}L${back(-7, 3.5)}z`}
    />
  )
}

/**
 * A straight or right-angled connector through `points`. Arrowheads land
 * exactly on the first or last point, so end an edge on a box anchor.
 */
export function Edge({
  points,
  from = false,
  to = true,
  dashed = false,
}: {
  points: readonly Point[]
  /** Arrowhead at the first point. */
  from?: boolean
  /** Arrowhead at the last point. */
  to?: boolean
  /** For a link that isn't a request, like a live sync. */
  dashed?: boolean
}) {
  checkGrid(`Edge ${points.map((p) => p.join(",")).join(" ")}`, points.flat())
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")
  const first = points[0]!
  const last = points[points.length - 1]!
  return (
    <g>
      <path
        className={dashed ? `${styles.edge} ${styles.dashed}` : styles.edge}
        d={d}
      />
      {from && <Head tip={first} from={points[1]!} />}
      {to && <Head tip={last} from={points[points.length - 2]!} />}
    </g>
  )
}
