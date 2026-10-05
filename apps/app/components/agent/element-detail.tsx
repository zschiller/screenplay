/**
 * The body of an element token's HoverCard — the detail its terse label hides:
 * the full CSS selector, then the route and frame as a label/value list, or,
 * for an element in a Mockup, which has no route, the Mockup's title. Shared
 * by the composer's node view and the sent-message bubble so the two cards
 * read the same.
 */
export function ElementDetail({
  selector,
  route,
  frameLabel,
  inMockup = false,
}: {
  selector: string
  route: string
  frameLabel?: string
  inMockup?: boolean
}) {
  if (inMockup) {
    return (
      <>
        <ElementSelector selector={selector} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Mockup</dt>
          <dd className="break-words">{frameLabel}</dd>
        </dl>
      </>
    )
  }
  return (
    <>
      <ElementSelector selector={selector} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Route</dt>
        <dd className="font-mono break-words">{route}</dd>
        {frameLabel ? (
          <>
            <dt className="text-muted-foreground">Frame</dt>
            <dd className="break-words">{frameLabel}</dd>
          </>
        ) : null}
      </dl>
    </>
  )
}

/**
 * A CSS selector that wraps only between its parts: each part (with its
 * trailing ` >`) is an inline-block, so a line breaks after a combinator and
 * never inside `nth-of-type(1)`. A part wider than the whole card still wraps
 * inside itself rather than overflowing.
 */
function ElementSelector({ selector }: { selector: string }) {
  if (!selector) {
    return (
      <div className="font-mono text-xs text-muted-foreground">
        (no selector)
      </div>
    )
  }
  const parts = splitSelector(selector)
  return (
    <div className="font-mono text-xs leading-relaxed text-muted-foreground">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          <span className="inline-block max-w-full [overflow-wrap:anywhere]">
            {i < parts.length - 1 ? `${part} >` : part}
          </span>
        </span>
      ))}
    </div>
  )
}

/** `a > b > c` → `["a", "b", "c"]`; a selector with no child combinator stays whole. */
export function splitSelector(selector: string): string[] {
  return selector
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}
