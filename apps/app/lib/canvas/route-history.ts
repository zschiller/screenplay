/**
 * A frame's back/forward history (issue #795): the routes it has shown this
 * session, and which one it's on. The preview is cross-origin, so the canvas
 * can't drive the page's own `history`; it keeps this list instead and steps
 * the frame's route through it.
 *
 * Pure and immutable: every verb returns a new history (or the same one when
 * nothing changes), so React state can hold it directly.
 */
export interface RouteHistory {
  entries: readonly string[]
  index: number
}

export function createRouteHistory(route: string): RouteHistory {
  return { entries: [route], index: 0 }
}

export function currentRoute(history: RouteHistory): string {
  return history.entries[history.index] ?? "/"
}

export function canGoBack(history: RouteHistory): boolean {
  return history.index > 0
}

export function canGoForward(history: RouteHistory): boolean {
  return history.index < history.entries.length - 1
}

/**
 * The frame moved to `route` by any means other than back/forward (a link in
 * the page, the route field, another user). Like a browser, it drops the
 * forward entries. Replace-style navigations edit the current entry instead.
 */
export function visitRoute(
  history: RouteHistory,
  route: string,
  replace = false
): RouteHistory {
  if (route === currentRoute(history)) return history
  if (replace) {
    const entries = history.entries.slice()
    entries[history.index] = route
    return { entries, index: history.index }
  }
  const entries = [...history.entries.slice(0, history.index + 1), route]
  return { entries, index: entries.length - 1 }
}

export function goBack(history: RouteHistory): RouteHistory {
  return canGoBack(history) ? { ...history, index: history.index - 1 } : history
}

export function goForward(history: RouteHistory): RouteHistory {
  return canGoForward(history)
    ? { ...history, index: history.index + 1 }
    : history
}
