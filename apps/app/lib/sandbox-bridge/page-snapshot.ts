/**
 * What the Sandbox Bridge's `getPageSnapshot` op answers (#1268): a frame's
 * rendered page, split so the server can assemble and cap it. `markup` is the
 * body's inner HTML (or the selected element's outer HTML) with scripts and
 * stylesheets removed; `css` is the text of the rules that can style it.
 */
export type PageSnapshot = {
  /** The page's URL as the browser has it now. */
  url: string
  title: string
  /** `<html>`'s attributes, serialized (`class="dark" lang="en"`). */
  htmlAttributes: string
  bodyAttributes: string
  markup: string
  css: string
  /** Cross-origin stylesheets, whose rules a page can't read. */
  stylesheetLinks: string[]
}

/** How the script below fails when the page has no bridge, or an older one. */
export const NO_BRIDGE = "the page has no Sandbox Bridge"
export const STALE_BRIDGE = "unknown op: getPageSnapshot"

/** How long the script waits for the bridge's answer. */
const BRIDGE_TIMEOUT_MS = 5_000

/**
 * The body of an async function that asks the page's bridge for a snapshot and
 * resolves to it as JSON (`null` when `selector` matches nothing). It runs in
 * a headless page, where the bridge's `parent` is the page itself: the query
 * is dispatched as a message from the page to itself, and the bridge's answer
 * comes back through the page's own `postMessage`.
 */
export function pageSnapshotScript(selector: string | undefined): string {
  return `
const selector = ${JSON.stringify(selector ?? null)};
if (!window.__screenplayBridge) throw new Error(${JSON.stringify(NO_BRIDGE)});
const id = "screenplay-read-" + Math.random().toString(36).slice(2);
const value = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    window.removeEventListener("message", onMessage);
    reject(new Error("the page’s Sandbox Bridge didn’t answer"));
  }, ${BRIDGE_TIMEOUT_MS});
  function onMessage(e) {
    const d = e.data;
    if (!d || d.type !== "screenplay:dom-result" || d.id !== id) return;
    clearTimeout(timer);
    window.removeEventListener("message", onMessage);
    if (d.ok) resolve(d.value);
    else reject(new Error(d.error));
  }
  window.addEventListener("message", onMessage);
  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "screenplay:dom-query", op: "getPageSnapshot", id, selector },
    source: window,
  }));
});
return JSON.stringify(value);
`
}
