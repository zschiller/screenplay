/**
 * A short, readable name for the element a comment points at, from the CSS
 * selector stored with the thread: the last step of the selector as its tag,
 * plus `#id` when it has one (the same `tag#id` form the composer's element
 * tokens use). Classes and `:nth-*` positions are noise and are dropped.
 */
export function selectorLabel(
  selector: string | null | undefined
): string | null {
  if (!selector) return null
  const steps = selector.trim().split(/\s*[>+~]\s*|\s+/)
  const last = steps[steps.length - 1]
  if (!last) return null
  const id = /#([A-Za-z_][\w-]*)/.exec(last)?.[1]
  const tag = /^[a-zA-Z][\w-]*/.exec(last)?.[0]?.toLowerCase()
  if (tag && id) return `${tag}#${id}`
  if (id) return `#${id}`
  return tag ?? null
}
