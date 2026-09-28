import { describe, expect, it } from "vitest"

import {
  lostWork,
  lostWorkWarning,
  projectLostWorkWarning,
  workspaceStateChip,
} from "./unsaved-work"

const hosted = { localBranchKept: false }
const local = { localBranchKept: true }
const work = (unpushedCommits: number, uncommittedFiles: number) => ({
  onOrigin: true,
  unpushedCommits,
  uncommittedFiles,
})

describe("lostWork", () => {
  it("loses unpushed commits with a hosted Sandbox", () => {
    expect(lostWork(work(2, 1), hosted)).toEqual({ commits: 2, files: 1 })
  })

  it("keeps commits on the local build, where the git branch survives", () => {
    expect(lostWork(work(2, 1), local)).toEqual({ commits: 0, files: 1 })
  })
})

describe("lostWorkWarning", () => {
  it.each([
    [{ commits: 0, files: 0 }, null],
    [{ commits: 1, files: 0 }, "1 unpushed commit will be lost."],
    [{ commits: 2, files: 0 }, "2 unpushed commits will be lost."],
    [{ commits: 0, files: 1 }, "1 uncommitted file will be lost."],
    [
      { commits: 2, files: 3 },
      "2 unpushed commits and 3 uncommitted files will be lost.",
    ],
  ])("%j → %j", (lost, expected) => {
    expect(lostWorkWarning(lost)).toBe(expected)
  })
})

describe("projectLostWorkWarning", () => {
  it("is silent when no workspace loses anything", () => {
    expect(projectLostWorkWarning([{ commits: 0, files: 0 }])).toBeNull()
  })

  it("counts the workspaces that lose work", () => {
    expect(
      projectLostWorkWarning([
        { commits: 2, files: 0 },
        { commits: 0, files: 1 },
        { commits: 0, files: 0 },
      ])
    ).toBe("Unpushed work in 2 workspaces will be lost.")
    expect(projectLostWorkWarning([{ commits: 0, files: 1 }])).toBe(
      "Uncommitted files in 1 workspace will be lost."
    )
  })
})

describe("workspaceStateChip", () => {
  const noPr = { open: false }

  it("shows a spinner while the checkout is read", () => {
    expect(workspaceStateChip(undefined, noPr, hosted)).toEqual({
      kind: "loading",
    })
  })

  it("leads with work that would be lost, over an open PR", () => {
    expect(
      workspaceStateChip(work(2, 0), { number: 482, open: true }, hosted)
    ).toEqual({ kind: "lost", label: "2 unpushed" })
    expect(workspaceStateChip(work(0, 3), noPr, hosted)).toEqual({
      kind: "lost",
      label: "3 uncommitted",
    })
  })

  it("then an open PR, then kept commits, then Clean", () => {
    expect(
      workspaceStateChip(work(0, 0), { number: 482, open: true }, hosted)
    ).toEqual({ kind: "pr", label: "PR #482" })
    expect(workspaceStateChip(work(2, 0), noPr, local)).toEqual({
      kind: "unpushed",
      label: "2 unpushed",
    })
    expect(workspaceStateChip(work(0, 0), noPr, hosted)).toEqual({
      kind: "clean",
      label: "Clean",
    })
  })

  it("claims nothing about an unreadable checkout but its PR", () => {
    expect(workspaceStateChip(null, noPr, hosted)).toBeNull()
    expect(workspaceStateChip(null, { number: 7, open: true }, hosted)).toEqual(
      {
        kind: "pr",
        label: "PR #7",
      }
    )
  })
})
