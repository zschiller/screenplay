/**
 * The messy fixture canvas the Coordinator canvas eval starts every ask from
 * (`coordinator-canvas.eval.test.ts`). Kept free of server-only imports so the
 * screenshot harness can render it too.
 */
import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  RepoData,
} from "@/lib/types"

const now = Date.UTC(2026, 8, 30, 12)
const repoId = "repo-storefront"

function branch(
  id: string,
  title: string,
  ref: string,
  extra: Partial<BranchData> = {}
): BranchData {
  return {
    id,
    repoId,
    sandboxName: ref,
    gitUrl: "https://github.com/acme/storefront.git",
    ref,
    title,
    previewDomain: `${ref}.preview.test`,
    port: 3000,
    status: "running",
    createdAt: now - 60_000,
    lastActivityAt: now - 60_000,
    colorIndex: 0,
    sidebarOrder: 0,
    ...extra,
  } as BranchData
}

function frame(
  id: string,
  label: string,
  branchId: string | undefined,
  route: string | undefined,
  size: "desktop" | "phone"
): IframeLayerData {
  return {
    id,
    label,
    ...(branchId ? { branchId } : {}),
    ...(route ? { route } : {}),
    width: size === "desktop" ? 1280 : 402,
    height: size === "desktop" ? 800 : 874,
    iframeState: {},
  } as IframeLayerData
}

function group(
  id: string,
  name: string,
  x: number,
  y: number,
  members: Array<[kind: "iframe-layer" | "markdown-layer", id: string]>
): IframeLayerGroupData {
  return {
    id,
    name,
    x,
    y,
    members: members.map(([kind, id]) => ({ kind, id })),
  } as IframeLayerGroupData
}

/**
 * A canvas that grew by hand: the variants landed wherever, the brief is far
 * off, a blank frame was never used, and two Groups overlap.
 */
export function messyCanvas() {
  const repo = {
    id: repoId,
    name: "storefront",
    repoFullName: "acme/storefront",
    repoOwner: "acme",
    repoName: "storefront",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/storefront.git",
    createdAt: now - 86_400_000,
    sidebarOrder: 0,
  } as RepoData
  const branches = [
    branch("ws-polish", "Checkout polish", "checkout-polish"),
    branch("ws-cart", "Empty cart state", "empty-cart-state"),
    branch("ws-a", "Checkout: single column", "checkout-single-column"),
    branch("ws-b", "Checkout: split screen", "checkout-split-screen"),
    branch("ws-c", "Checkout: accordion", "checkout-accordion"),
  ]
  const iframeLayers = [
    frame(
      "f-polish-desk",
      "Checkout · desktop",
      "ws-polish",
      "/checkout",
      "desktop"
    ),
    frame(
      "f-polish-phone",
      "Checkout · iPhone 17 Pro",
      "ws-polish",
      "/checkout",
      "phone"
    ),
    frame("f-cart", "Empty cart", "ws-cart", "/cart", "desktop"),
    frame("f-blank", "Frame", undefined, undefined, "desktop"),
    frame("f-a-desk", "Checkout", "ws-a", "/checkout", "desktop"),
    frame("f-a-phone", "Checkout · phone", "ws-a", "/checkout", "phone"),
    frame("f-b-desk", "Checkout", "ws-b", "/checkout", "desktop"),
    frame("f-c-desk", "Checkout", "ws-c", "/checkout", "desktop"),
  ]
  const markdownLayers = [
    { id: "doc-brief", title: "Checkout brief", width: 720, height: 800 },
  ] as MarkdownLayerData[]
  const iframeLayerGroups = [
    group("g-polish", "Checkout polish", 0, 0, [
      ["iframe-layer", "f-polish-desk"],
      ["iframe-layer", "f-polish-phone"],
    ]),
    // Overlaps Checkout polish's phone frame.
    group("g-cart", "Empty cart state", 1500, 300, [
      ["iframe-layer", "f-cart"],
    ]),
    group("g-blank", "Group 3", 400, 1150, [["iframe-layer", "f-blank"]]),
    group("g-a", "Checkout: single column", 2300, 2200, [
      ["iframe-layer", "f-a-desk"],
      ["iframe-layer", "f-a-phone"],
    ]),
    group("g-b", "Checkout: split screen", -1900, 2600, [
      ["iframe-layer", "f-b-desk"],
    ]),
    group("g-c", "Checkout: accordion", 3600, 700, [
      ["iframe-layer", "f-c-desk"],
    ]),
    group("g-brief", "Group 7", 6200, -900, [["markdown-layer", "doc-brief"]]),
  ]
  return {
    repos: [repo],
    branches,
    iframeLayers,
    markdownLayers,
    iframeLayerGroups,
  }
}
