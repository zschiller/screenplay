import { describe, expect, it } from "vitest"
import { projectUserTurn } from "@/lib/agent/user-turn"
import type { RoomDoc } from "@/lib/room-access"
import type { BranchData } from "@/lib/types"
import { baseBranch, baseRepo, makeHarness } from "@/test/canvas/harness"
import { prEventLabel, prEventMessage, prEventState } from "./events"
import {
  watchRoomPrs,
  type GitHubPrReader,
  type PrLookup,
  type PrTarget,
} from "./watch"

/**
 * PR Watch (#1702) at its seam: a seeded Room doc and a fake GitHub reader in,
 * doc writes and PR events out.
 */

const URL = "https://github.com/owner/repo/pull/7"
const open = (more: Partial<PrLookup> = {}): PrLookup => ({
  number: 7,
  url: URL,
  state: "open",
  ...more,
})

function seed(branch: Partial<BranchData> = {}) {
  const { collections } = makeHarness()
  collections.repos.set("repo-1", baseRepo("repo-1"))
  collections.branches.set(
    "b1",
    baseBranch("b1", { ref: "feat", createdBy: "u1", ...branch })
  )
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async (fn) => fn(collections),
    mutateDoc: async (fn) => fn(collections),
  }
  return { room, collections }
}

/** A reader that answers each look with the next lookup, recording what it
 *  was asked for. */
function fakeGitHub(...answers: Array<PrLookup | null>) {
  const asked: PrTarget[] = []
  const read: GitHubPrReader = async (target) => {
    asked.push(target)
    return answers.length > 1 ? answers.shift()! : answers[0]!
  }
  return { read, asked }
}

/** Look once per lookup and collect every event's kind and detail. */
async function watchThrough(room: RoomDoc, ...lookups: Array<PrLookup | null>) {
  const seen: string[] = []
  for (const pr of lookups) {
    const { events } = await watchRoomPrs(room, fakeGitHub(pr).read)
    for (const e of events) seen.push(prEventLabel(e))
  }
  return seen
}

describe("watchRoomPrs", () => {
  it("caches a first look at a PR and reports nothing", async () => {
    const { room, collections } = seed()
    const result = await watchRoomPrs(
      room,
      fakeGitHub(open({ checks: "failing", failingChecks: ["lint"] })).read
    )
    expect(result.events).toEqual([])
    expect(result.hasOpenPr).toBe(true)
    expect(collections.branches.get("b1")).toMatchObject({
      prNumber: 7,
      prUrl: URL,
      prState: "open",
      prChecks: "failing",
      prChecksFailed: true,
    })
  })

  it("reports checks failing with the failed checks' names", async () => {
    const { room } = seed({ prNumber: 7, prUrl: URL, prState: "open" })
    const { events } = await watchRoomPrs(
      room,
      fakeGitHub(
        open({
          checks: "failing",
          failingChecks: ["lint", "typecheck"],
          blocked: true,
        })
      ).read
    )
    expect(events).toEqual([
      {
        branchId: "b1",
        number: 7,
        url: URL,
        kind: "checks_failed",
        detail: "lint, typecheck",
      },
    ])
  })

  it("reports checks passing again after a re-run, and failing again", async () => {
    const { room } = seed({ prNumber: 7, prUrl: URL, prState: "open" })
    expect(
      await watchThrough(
        room,
        open({ checks: "pending" }),
        open({ checks: "failing", failingChecks: ["lint"] }),
        open({ checks: "pending" }),
        open({ checks: "passing" }),
        open({ checks: "pending" }),
        open({ checks: "failing", failingChecks: ["test"] })
      )
    ).toEqual(["checks failed · lint", "checks passed", "checks failed · test"])
  })

  it("says nothing about checks that pass without having failed", async () => {
    const { room } = seed({ prNumber: 7, prUrl: URL, prState: "open" })
    expect(
      await watchThrough(
        room,
        open({ checks: "pending" }),
        open({ checks: "passing" }),
        open({ checks: "passing" })
      )
    ).toEqual([])
  })

  it("reports a new conflict once", async () => {
    const { room } = seed({ prNumber: 7, prUrl: URL, prState: "open" })
    expect(
      await watchThrough(
        room,
        open({ conflict: true, blocked: true }),
        open({ conflict: true, blocked: true }),
        open(),
        open({ conflict: true, blocked: true })
      )
    ).toEqual(["conflict", "conflict"])
  })

  it("reports the merge and clears what only an open PR has", async () => {
    const { room, collections } = seed({
      prNumber: 7,
      prUrl: URL,
      prState: "open",
      prBlocked: true,
      prChecks: "failing",
      prChecksFailed: true,
      prConflict: true,
    })
    const result = await watchRoomPrs(
      room,
      fakeGitHub({ number: 7, url: URL, state: "merged" }).read
    )
    expect(result.events.map((e) => e.kind)).toEqual(["merged"])
    expect(result.hasOpenPr).toBe(false)
    const branch = collections.branches.get("b1")!
    expect(branch.prState).toBe("merged")
    for (const key of [
      "prBlocked",
      "prChecks",
      "prChecksFailed",
      "prConflict",
    ]) {
      expect(branch).not.toHaveProperty(key)
    }
  })

  it("reports a PR closed without merging", async () => {
    const { room } = seed({ prNumber: 7, prUrl: URL, prState: "open" })
    expect(
      await watchThrough(room, { number: 7, url: URL, state: "closed" })
    ).toEqual(["closed"])
  })

  it("reports nothing when nothing changed", async () => {
    const { room } = seed({ prNumber: 7, prUrl: URL, prState: "open" })
    expect(
      await watchThrough(
        room,
        open({ checks: "failing", failingChecks: ["lint"] }),
        open({ checks: "failing", failingChecks: ["lint"] }),
        open({ checks: "failing", failingChecks: ["lint"] })
      )
    ).toEqual(["checks failed · lint"])
  })

  it("never clears a cached PR on a null lookup", async () => {
    const cached = {
      prNumber: 7,
      prUrl: URL,
      prState: "open" as const,
      prChecks: "failing" as const,
      prChecksFailed: true,
    }
    const { room, collections } = seed(cached)
    const result = await watchRoomPrs(room, fakeGitHub(null).read)
    expect(result.events).toEqual([])
    expect(result.hasOpenPr).toBe(true)
    expect(collections.branches.get("b1")).toMatchObject(cached)
  })

  it("treats a newly opened PR as a new baseline", async () => {
    const { room, collections } = seed({
      prNumber: 7,
      prUrl: URL,
      prState: "merged",
    })
    const next = { number: 8, url: `${URL}8`, state: "open" as const }
    expect(
      await watchThrough(room, { ...next, checks: "failing" as const })
    ).toEqual([])
    expect(collections.branches.get("b1")?.prNumber).toBe(8)
  })

  it("looks up Branches with their repository, ref and owner", async () => {
    const { room, collections } = seed()
    collections.branches.set("main", baseBranch("main", { ref: "main" }))
    const github = fakeGitHub(null)
    await watchRoomPrs(room, github.read)
    expect(github.asked).toEqual([
      {
        branchId: "b1",
        owner: "owner",
        repo: "repo",
        branch: "feat",
        ownerId: "u1",
      },
    ])
  })

  it("looks only at open PRs for the server tick", async () => {
    const { room, collections } = seed({
      prNumber: 7,
      prUrl: URL,
      prState: "open",
    })
    collections.branches.set(
      "b2",
      baseBranch("b2", { ref: "done", prNumber: 6, prState: "merged" })
    )
    collections.branches.set("b3", baseBranch("b3", { ref: "new" }))
    const github = fakeGitHub(null)
    await watchRoomPrs(room, github.read, { openOnly: true })
    expect(github.asked.map((t) => t.branchId)).toEqual(["b1"])
  })

  it("treats a failed lookup like a null one", async () => {
    const { room, collections } = seed({
      prNumber: 7,
      prUrl: URL,
      prState: "open",
    })
    const result = await watchRoomPrs(room, async () => {
      throw new Error("GitHub is down")
    })
    expect(result.prs).toEqual([{ id: "b1", pr: null }])
    expect(collections.branches.get("b1")?.prState).toBe("open")
  })
})

describe("PR event messages", () => {
  it("round-trip through the chat's user-turn projection", () => {
    const wire = prEventMessage({
      branchId: "b1",
      number: 482,
      url: URL,
      kind: "checks_failed",
      detail: "lint [ci] / build",
    })
    expect(projectUserTurn(wire)).toMatchObject({
      prEvent: {
        number: 482,
        kind: "checks_failed",
        detail: "lint [ci] / build",
      },
      body: expect.stringContaining(
        "PR #482’s checks failed: lint [ci] / build."
      ),
    })
  })

  it("label and colour each event", () => {
    expect(prEventLabel({ kind: "checks_failed", detail: "lint" })).toBe(
      "checks failed · lint"
    )
    expect(prEventLabel({ kind: "merged" })).toBe("merged")
    expect(prEventState("checks_passed")).toBe("open")
    expect(prEventState("merged")).toBe("merged")
    expect(prEventState("checks_failed")).toBe("closed")
    expect(prEventState("conflict")).toBe("closed")
    expect(prEventState("closed")).toBe("closed")
  })
})

describe("watchRoomPrs keeps the Branch's PR history (#1701)", () => {
  const url = (n: number) => `https://github.com/owner/repo/pull/${n}`

  it("moves the merged PR into the past PRs when the next one opens", async () => {
    const { room, collections } = seed({
      prNumber: 7,
      prUrl: url(7),
      prState: "merged",
      prTitle: "One-scroll checkout",
    })
    const { events } = await watchRoomPrs(
      room,
      fakeGitHub({
        number: 9,
        url: url(9),
        state: "open",
        title: "Apple Pay",
        earlier: [
          {
            number: 7,
            url: url(7),
            title: "One-scroll checkout",
            state: "merged",
          },
        ],
      }).read
    )
    // A new PR is the baseline: nothing to report yet.
    expect(events).toEqual([])
    expect(collections.branches.get("b1")).toMatchObject({
      prNumber: 9,
      prState: "open",
      prTitle: "Apple Pay",
      pastPrs: [
        {
          number: 7,
          url: url(7),
          title: "One-scroll checkout",
          state: "merged",
        },
      ],
    })
  })

  it("never lets a lagging list's older PR replace the current one", async () => {
    const { room, collections } = seed({
      prNumber: 9,
      prUrl: url(9),
      prState: "open",
      pastPrs: [{ number: 7, url: url(7), state: "open" }],
    })
    const { events } = await watchRoomPrs(
      room,
      fakeGitHub({ number: 7, url: url(7), state: "merged" }).read
    )
    expect(events).toEqual([])
    expect(collections.branches.get("b1")).toMatchObject({
      prNumber: 9,
      prState: "open",
      pastPrs: [{ number: 7, url: url(7), state: "merged" }],
    })
  })
})
