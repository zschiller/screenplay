// The docs site is served beneath `/docs` (see next.config.mjs), and plain
// `<img>` sources aren't rewritten by Next, so public assets need the prefix.
const BASE_PATH = "/docs"

type ScreenshotProps = {
  /** File stem under `public/screenshots/` — `<name>.light.webp` / `<name>.dark.webp`. */
  name: string
  alt: string
  caption?: React.ReactNode
}

/**
 * A framed product screenshot with a light and a dark variant; CSS in
 * `app/globals.css` shows the one matching the docs theme. Screenshots are
 * captured from a real running Screenplay and framed by the capture pipeline:
 * full-window shots carry their own background and window chrome, while
 * details are the bare UI, which the CSS rounds and outlines. Captures are 2x,
 * so `srcSet` shows each at its own size (capped at the column) instead of
 * stretching a small detail to the column's width.
 */
export function Screenshot({ name, alt, caption }: ScreenshotProps) {
  const src = (theme: "light" | "dark") =>
    `${BASE_PATH}/screenshots/${name}.${theme}.webp`
  return (
    <figure className="sp-screenshot">
      {/* eslint-disable-next-line @next/next/no-img-element -- static, pre-optimized webp */}
      <img
        className="sp-screenshot-light"
        src={src("light")}
        srcSet={`${src("light")} 2x`}
        alt={alt}
        loading="lazy"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="sp-screenshot-dark"
        src={src("dark")}
        srcSet={`${src("dark")} 2x`}
        alt=""
        aria-hidden
        loading="lazy"
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
