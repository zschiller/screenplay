import { describe, expect, it } from "vitest"

import {
  activeMentionQuery,
  insertMention,
  matchMembers,
  splitMentions,
} from "./comment-mentions"

describe("activeMentionQuery", () => {
  it("finds the query after an @ at a word start", () => {
    expect(activeMentionQuery("Thanks @Ri", 10)).toEqual({
      start: 7,
      query: "Ri",
    })
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" })
  })

  it("ignores an @ inside a word, like an email", () => {
    expect(activeMentionQuery("me@example", 10)).toBeNull()
  })

  it("stops at a newline or a second word", () => {
    expect(activeMentionQuery("@Ri\nx", 5)).toBeNull()
    expect(activeMentionQuery("@Ann Lee said", 13)).toBeNull()
  })
})

describe("matchMembers", () => {
  const members = [{ name: "Riley Park" }, { name: "Zack" }, { name: "Ann" }]
  it("matches a prefix of the name or of any word", () => {
    expect(matchMembers(members, "ri")).toEqual([{ name: "Riley Park" }])
    expect(matchMembers(members, "par")).toEqual([{ name: "Riley Park" }])
    expect(matchMembers(members, "")).toHaveLength(3)
  })
})

describe("insertMention", () => {
  it("replaces the query with the name and a trailing space", () => {
    expect(insertMention("Hi @ri there", 3, 6, "Riley")).toEqual({
      text: "Hi @Riley  there",
      caret: 10,
    })
  })
})

describe("splitMentions", () => {
  it("marks known member names and leaves the rest plain", () => {
    expect(
      splitMentions("@Ann Lee and @Ann, not a@Ann", ["Ann", "Ann Lee"])
    ).toEqual([
      { text: "@Ann Lee", mention: true },
      { text: " and ", mention: false },
      { text: "@Ann", mention: true },
      { text: ", not a@Ann", mention: false },
    ])
  })

  it("returns the body whole when there are no names", () => {
    expect(splitMentions("hi @x", [])).toEqual([
      { text: "hi @x", mention: false },
    ])
  })
})
