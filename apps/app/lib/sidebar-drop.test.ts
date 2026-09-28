import { describe, expect, it } from "vitest"
import {
  reorderToGap,
  resolveRepoListDrop,
  resolveSidebarDrop,
  type RepoListDrop,
  type SidebarDrop,
  type SidebarDropGroup,
  type SidebarDropRepo,
  type SidebarRow,
} from "@/lib/sidebar-drop"

const f = (id: string) => ({ kind: "iframe-layer", id })

/**
 * Sidebar as the user sees it:
 *   gap:0
 *   G1 ▾            group:g1
 *     a             member:iframe-layer:a
 *     b             member:iframe-layer:b
 *     c             member:iframe-layer:c
 *   gap:1
 *   d               flat:g2
 *   gap:2
 *   G3 ▾            group:g3
 *     e             member:iframe-layer:e
 *     x             member:iframe-layer:x
 *   gap:3
 */
const groups: SidebarDropGroup[] = [
  { id: "g1", members: [f("a"), f("b"), f("c")] },
  { id: "g2", members: [f("d")] },
  { id: "g3", members: [f("e"), f("x")] },
]
const rows: SidebarRow[] = [
  { kind: "group-header", groupId: "g1" },
  { kind: "member", groupId: "g1", member: f("a") },
  { kind: "member", groupId: "g1", member: f("b") },
  { kind: "member", groupId: "g1", member: f("c") },
  { kind: "flat", groupId: "g2", member: f("d") },
  { kind: "group-header", groupId: "g3" },
  { kind: "member", groupId: "g3", member: f("e") },
  { kind: "member", groupId: "g3", member: f("x") },
]

const m = (id: string) => `member:iframe-layer:${id}`
const into = (member: string, groupId: string, index: number) => ({
  kind: "move-member",
  member: f(member),
  target: { kind: "into-group", groupId, index },
})
const newGroup = (member: string, sidebarIndex: number) => ({
  kind: "move-member",
  member: f(member),
  target: { kind: "new-group", sidebarIndex },
})
const reorder = (...orderedIds: string[]) => ({
  kind: "reorder-groups",
  orderedIds,
})
const line = (rowId: string, edge: "before" | "after") => ({
  kind: "line",
  rowId,
  edge,
})
const ring = (rowId: string) => ({ kind: "into", rowId })
const NONE: SidebarDrop = { hint: null, intent: null }

type Case = [
  name: string,
  active: string,
  over: string,
  side: "before" | "after",
  expected: SidebarDrop | { hint: unknown; intent: unknown },
]

const cases: Case[] = [
  // --- into an existing Group ---
  [
    "member onto another Group's header appends",
    m("a"),
    "group:g3",
    "after",
    { hint: ring("group:g3"), intent: into("a", "g3", 2) },
  ],
  [
    "flat row onto a Group's header appends",
    "flat:g2",
    "group:g1",
    "before",
    { hint: ring("group:g1"), intent: into("d", "g1", 3) },
  ],
  [
    "member onto a flat row merges after its member",
    m("e"),
    "flat:g2",
    "before",
    { hint: ring("flat:g2"), intent: into("e", "g2", 1) },
  ],
  ["flat row onto itself does nothing", "flat:g2", "flat:g2", "after", NONE],
  [
    "member before a member of another Group",
    m("a"),
    m("x"),
    "before",
    { hint: line(m("x"), "before"), intent: into("a", "g3", 1) },
  ],
  [
    "flat row after the last member of a Group",
    "flat:g2",
    m("c"),
    "after",
    { hint: line(m("c"), "after"), intent: into("d", "g1", 3) },
  ],

  // --- before/after at Group edges ---
  [
    "before the first member of a Group",
    m("x"),
    m("a"),
    "before",
    { hint: line(m("a"), "before"), intent: into("x", "g1", 0) },
  ],
  [
    "after a middle member paints before the next one",
    m("e"),
    m("a"),
    "after",
    { hint: line(m("b"), "before"), intent: into("e", "g1", 1) },
  ],
  [
    "after the last member stays on its own edge",
    m("e"),
    m("c"),
    "after",
    { hint: line(m("c"), "after"), intent: into("e", "g1", 3) },
  ],
  [
    "after the last member doesn't collapse onto the next Group",
    m("a"),
    m("x"),
    "after",
    { hint: line(m("x"), "after"), intent: into("a", "g3", 2) },
  ],

  // --- same-Group reorder: indices as the sidebar shows them ---
  [
    "member down past its neighbour",
    m("a"),
    m("b"),
    "after",
    { hint: line(m("c"), "before"), intent: into("a", "g1", 2) },
  ],
  [
    "member to the end of its Group",
    m("a"),
    m("c"),
    "after",
    { hint: line(m("c"), "after"), intent: into("a", "g1", 3) },
  ],
  [
    "member up to the top of its Group",
    m("c"),
    m("a"),
    "before",
    { hint: line(m("a"), "before"), intent: into("c", "g1", 0) },
  ],
  ["member onto itself does nothing", m("b"), m("b"), "after", NONE],

  // --- new Group ---
  [
    "member into a gap splits into a new Group",
    m("b"),
    "gap:2",
    "before",
    { hint: null, intent: newGroup("b", 2) },
  ],
  [
    "member into the gap after the last Group",
    m("e"),
    "gap:3",
    "after",
    { hint: null, intent: newGroup("e", 3) },
  ],
  [
    "member onto its own Group's header extracts above it",
    m("x"),
    "group:g3",
    "before",
    { hint: null, intent: newGroup("x", 2) },
  ],

  // --- Group reorder ---
  [
    "Group header into an earlier gap",
    "group:g3",
    "gap:0",
    "before",
    { hint: null, intent: reorder("g3", "g1", "g2") },
  ],
  [
    "Group header into a later gap",
    "group:g1",
    "gap:3",
    "after",
    { hint: null, intent: reorder("g2", "g3", "g1") },
  ],
  [
    "flat row into a gap keeps its Group",
    "flat:g2",
    "gap:0",
    "before",
    { hint: null, intent: reorder("g2", "g1", "g3") },
  ],
  [
    "Group into the gap it already sits in does nothing",
    "group:g1",
    "gap:1",
    "before",
    NONE,
  ],
  [
    "Group header before another Group's member row",
    "group:g3",
    m("a"),
    "before",
    { hint: null, intent: reorder("g3", "g1", "g2") },
  ],
  [
    "Group header after another Group's header",
    "group:g1",
    "group:g3",
    "after",
    { hint: null, intent: reorder("g2", "g3", "g1") },
  ],
  [
    "Group header onto its own member does nothing",
    "group:g1",
    m("b"),
    "after",
    NONE,
  ],

  // --- unknown ids ---
  ["unknown dragged row", m("zz"), m("a"), "before", NONE],
  ["unknown over id", m("a"), "nope", "before", NONE],
]

describe("resolveSidebarDrop", () => {
  it.each(cases)("%s", (_name, activeId, overId, side, expected) => {
    expect(
      resolveSidebarDrop({ rows, groups, activeId, overId, side })
    ).toEqual(expected)
  })
})

describe("reorderToGap", () => {
  it.each([
    [["a", "b", "c"], "a", 0, null],
    [["a", "b", "c"], "a", 1, null],
    [["a", "b", "c"], "a", 2, ["b", "a", "c"]],
    [["a", "b", "c"], "c", 0, ["c", "a", "b"]],
    [["a", "b", "c"], "b", 3, ["a", "c", "b"]],
    [["a", "b", "c"], "missing", 0, null],
  ] as const)("%j: %s to gap %i", (ids, id, gap, expected) => {
    expect(reorderToGap(ids, id, gap)).toEqual(expected)
  })
})

/**
 * Repositories list as the user sees it:
 *   repogap:0
 *   r1              repo:r1
 *     p             branch:p
 *     q             branch:q
 *     s             branch:s
 *   repogap:1
 *   r2              repo:r2
 *     t             branch:t
 *   repogap:2
 *   r3              repo:r3
 *   repogap:3
 */
const repos: SidebarDropRepo[] = [
  { id: "r1", branchIds: ["p", "q", "s"] },
  { id: "r2", branchIds: ["t"] },
  { id: "r3", branchIds: [] },
]

const NO_REPO_DROP: RepoListDrop = { hint: null, intent: null }
const br = (id: string) => `branch:${id}`
const branchLine = (id: string, edge: "before" | "after") => ({
  kind: "line",
  rowId: br(id),
  edge,
})
const repoOrder = (...orderedIds: string[]) => ({
  hint: null,
  intent: { kind: "reorder-repos", orderedIds },
})
const branchOrder = (repoId: string, ...orderedIds: string[]) => ({
  kind: "reorder-branches",
  repoId,
  orderedIds,
})

const repoCases: [
  string,
  string,
  string,
  "before" | "after",
  RepoListDrop | object,
][] = [
  // --- Repo into a gap strip ---
  [
    "repo to the top",
    "repo:r3",
    "repogap:0",
    "before",
    repoOrder("r3", "r1", "r2"),
  ],
  [
    "repo to the end",
    "repo:r1",
    "repogap:3",
    "before",
    repoOrder("r2", "r3", "r1"),
  ],
  [
    "repo down one",
    "repo:r1",
    "repogap:2",
    "after",
    repoOrder("r2", "r1", "r3"),
  ],
  ["repo into its own top gap", "repo:r2", "repogap:1", "before", NO_REPO_DROP],
  [
    "repo into its own bottom gap",
    "repo:r2",
    "repogap:2",
    "before",
    NO_REPO_DROP,
  ],
  ["repo over a row", "repo:r1", br("t"), "after", NO_REPO_DROP],
  ["repo over a repo", "repo:r1", "repo:r2", "after", NO_REPO_DROP],

  // --- Branch beside a sibling ---
  [
    "branch before a sibling",
    br("s"),
    br("p"),
    "before",
    {
      hint: branchLine("p", "before"),
      intent: branchOrder("r1", "s", "p", "q"),
    },
  ],
  [
    "branch after a sibling paints before the next",
    br("p"),
    br("q"),
    "after",
    {
      hint: branchLine("s", "before"),
      intent: branchOrder("r1", "q", "p", "s"),
    },
  ],
  [
    "branch after the last sibling",
    br("p"),
    br("s"),
    "after",
    {
      hint: branchLine("s", "after"),
      intent: branchOrder("r1", "q", "s", "p"),
    },
  ],
  [
    "branch back into its own slot",
    br("q"),
    br("p"),
    "after",
    { hint: branchLine("q", "before"), intent: null },
  ],
  ["branch over itself", br("q"), br("q"), "after", NO_REPO_DROP],
  [
    "branch over another repo's branch",
    br("p"),
    br("t"),
    "before",
    NO_REPO_DROP,
  ],
  ["branch over a gap strip", br("p"), "repogap:1", "before", NO_REPO_DROP],
  ["branch over a repo header", br("p"), "repo:r1", "after", NO_REPO_DROP],
  ["unknown branch", br("zz"), br("p"), "before", NO_REPO_DROP],
]

describe("resolveRepoListDrop", () => {
  it.each(repoCases)("%s", (_name, activeId, overId, side, expected) => {
    expect(resolveRepoListDrop({ repos, activeId, overId, side })).toEqual(
      expected
    )
  })
})
