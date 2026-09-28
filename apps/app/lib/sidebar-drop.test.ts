import { describe, expect, it } from "vitest"
import {
  reorderGroupsToGap,
  resolveSidebarDrop,
  type SidebarDrop,
  type SidebarDropGroup,
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

describe("reorderGroupsToGap", () => {
  it.each([
    [["a", "b", "c"], "a", 0, null],
    [["a", "b", "c"], "a", 1, null],
    [["a", "b", "c"], "a", 2, ["b", "a", "c"]],
    [["a", "b", "c"], "c", 0, ["c", "a", "b"]],
    [["a", "b", "c"], "b", 3, ["a", "c", "b"]],
    [["a", "b", "c"], "missing", 0, null],
  ] as const)("%j: %s to gap %i", (ids, id, gap, expected) => {
    expect(reorderGroupsToGap(ids, id, gap)).toEqual(expected)
  })
})
