import { lastChangedBy, layerChat } from "@/lib/canvas/layer-chat"
import { isSketchChat } from "@/lib/chat/sketch-chat"
import { mockupQuestion, type MockupQuestion } from "@/lib/agent/question"
import type { AgentMessage } from "@/lib/agent/types"
import type { DraftSource } from "@/lib/chat-draft-source-store"
import type { FrameDriverView } from "@/components/canvas/use-frame-control"
import type { ChatSessionData, MockupLayerData } from "@/lib/types"

/**
 * A Mockup's link to its chat (#1662): which chat its page talks to, whether
 * this viewer's tap speaks, and the page-to-chat verbs (Knobs ask, draft,
 * question, answer). React-free; the canvas builds one link from its stores
 * and hands it to every Mockup (`components/canvas/mockup-chat-link.tsx`).
 *
 * The chat that speaks for a Mockup is its {@link layerChat}: the Sketch Chat
 * that last changed it, or that chat's Workspace's chat (#1724). A Mockup
 * without one (made by hand, or whose last chat was deleted) goes to the chat
 * the panel shows, or a new Sketch Chat when the panel shows
 * the Coordinator. A question is the exception: any chat may ask one about a
 * Mockup (`ask_question` with a `mockup_id`), so the page shows it whichever
 * chat asked, and the answer goes back to that chat.
 */

/** A chat question about a Mockup, and the chat that asked it. */
export interface AskedQuestion extends MockupQuestion {
  chatId: string
}

/** What the panel shows, as far as the link reads it. */
export type ShownChat =
  | { kind: "agent"; branchId: string }
  | { kind: "sketch"; chatId: string }
  | { kind: "room" }
  | null

export interface MockupChatLinkDeps {
  mockups: readonly Pick<
    MockupLayerData,
    "id" | "title" | "lastChangedByChatId" | "ownerChatId"
  >[]
  chats: readonly Pick<
    ChatSessionData,
    "id" | "branchId" | "target" | "createdAt"
  >[]
  /** Each chat's transcript, as loaded with the canvas (the chat store). */
  transcripts: {
    messages: (chatId: string) => readonly AgentMessage[]
    subscribe: (chatId: string, listener: () => void) => () => void
  }
  /** The chat panel. */
  panel: {
    shown: () => ShownChat
    showSketchChat: (chatId: string) => void
    showWorkspaceChat: (branchId: string, chatId: string) => void
    showRoomChat: () => void
    /** Open a Workspace's chat, making one when it has none, and return it. */
    openWorkspaceChat: (branchId: string) => string
    /** Make a new Sketch Chat, show it, and return its id. */
    newSketchChat: () => string
  }
  input: {
    prefill: (chatId: string, text: string) => void
    sendWhenOpen: (chatId: string, text: string) => void
  }
  draftSource: { set: (chatId: string, source: DraftSource) => void }
  /**
   * Question ids already answered from a page: each question is answered
   * once, even if the page taps again before the message lands. Outlives the
   * link, which is rebuilt as Mockups and chats change.
   */
  answered: Set<string>
}

export interface MockupChatLink {
  /** Whether the Mockup offers the Knobs Ask: any Mockup on the canvas does. */
  canAsk(mockupId: string): boolean
  /** Start an "add a knob" request in the chat that can rewrite the page. */
  askForKnob(mockupId: string): void
  /**
   * The page's `screenplay.draft(text)` (#1645): the text goes in the chat's
   * composer, under a From row naming the Mockup, for the person to send.
   */
  draft(mockupId: string, text: string): void
  /**
   * The latest question any chat asked about the Mockup, answered or not. The
   * same object until a transcript changes.
   */
  question(mockupId: string): AskedQuestion | null
  /** Hear when a transcript {@link question} reads changes. */
  watchQuestions(listener: () => void): () => void
  /**
   * The page answered a question (#1644): show the chat that asked it and send
   * the option's label as the person's message, as a click on the card does.
   */
  answer(found: AskedQuestion, index: number): void
}

export function createMockupChatLink(deps: MockupChatLinkDeps): MockupChatLink {
  const { mockups, chats, panel, input } = deps
  const mockupOf = (id: string) => mockups.find((m) => m.id === id)
  const chatOf = (id: string) => {
    const mockup = mockupOf(id)
    return mockup ? layerChat(lastChangedBy(mockup), chats) : null
  }

  /** Open the chat that speaks for a Mockup and return its id. */
  function openChat(mockupId: string): string {
    const found = chatOf(mockupId)
    if (found?.kind === "sketch") {
      panel.showSketchChat(found.chatId)
      return found.chatId
    }
    if (found?.kind === "workspace") {
      panel.showWorkspaceChat(found.branchId, found.chatId)
      return found.chatId
    }
    const shown = panel.shown()
    if (shown?.kind === "agent") return panel.openWorkspaceChat(shown.branchId)
    if (shown?.kind === "sketch") {
      panel.showSketchChat(shown.chatId)
      return shown.chatId
    }
    return panel.newSketchChat()
  }

  /** Show a chat by id, wherever it lives. False when it's gone. */
  function showChat(chatId: string): boolean {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return false
    if (chat.target === "room") panel.showRoomChat()
    else if (isSketchChat(chat)) panel.showSketchChat(chat.id)
    else if (chat.branchId) panel.showWorkspaceChat(chat.branchId, chat.id)
    else return false
    return true
  }

  const asked = new Map<
    string,
    {
      transcripts: readonly (readonly AgentMessage[])[]
      found: AskedQuestion | null
    }
  >()

  return {
    canAsk(mockupId) {
      return !!mockupOf(mockupId)
    },

    askForKnob(mockupId) {
      const mockup = mockupOf(mockupId)
      if (!mockup || !this.canAsk(mockupId)) return
      input.prefill(
        openChat(mockupId),
        `Add a knob to the mockup "${mockup.title || "Untitled"}" that controls `
      )
    },

    draft(mockupId, text) {
      const mockup = mockupOf(mockupId)
      if (!mockup) return
      const chatId = openChat(mockupId)
      deps.draftSource.set(chatId, { mockupId, title: mockup.title })
      input.prefill(chatId, text)
    },

    question(mockupId) {
      const transcripts = chats.map((c) => deps.transcripts.messages(c.id))
      const hit = asked.get(mockupId)
      if (hit && transcripts.every((t, i) => t === hit.transcripts[i])) {
        return hit.found
      }
      // Each chat's latest question about it. An open one beats an answered
      // one, and the last changer's beats another chat's.
      const mockup = mockupOf(mockupId)
      const last = mockup && lastChangedBy(mockup)
      let found: AskedQuestion | null = null
      for (const [i, chat] of chats.entries()) {
        const latest = mockupQuestion([...transcripts[i]!], mockupId)
        if (!latest) continue
        const next = { ...latest, chatId: chat.id }
        if (!found || rank(next, last) > rank(found, last)) found = next
      }
      asked.set(mockupId, { transcripts, found })
      return found
    },

    watchQuestions(listener) {
      const offs = chats.map((c) => deps.transcripts.subscribe(c.id, listener))
      return () => offs.forEach((off) => off())
    },

    answer(found, index) {
      const option = found.question.options[index]
      if (!option || found.answer || deps.answered.has(found.toolCallId)) return
      if (!showChat(found.chatId)) return
      deps.answered.add(found.toolCallId)
      input.sendWhenOpen(found.chatId, option.label)
    },
  }
}

function rank(q: AskedQuestion, lastChatId: string | undefined): number {
  return (q.answer ? 0 : 2) + (q.chatId === lastChatId ? 1 : 0)
}

/** Who drives a Mockup's page and how this viewer sees it. */
export interface MockupViewer {
  /** This viewer interacts with their own copy of the page. */
  focused: boolean
  /** Who drives their own copy. */
  driver: FrameDriverView
  /** The page is live: one shared page every viewer's canvas hears from. */
  live: boolean
  /** Who drives the live page. */
  liveDriver: FrameDriverView
}

/** What a tap on a Mockup's page may say for this viewer. */
export interface PageVoice {
  /** Put a message in their composer (`screenplay.draft`). */
  draft: boolean
  /** Answer the open question (`screenplay.answer`). */
  answer: boolean
}

/**
 * The one gate for what a tap on the page says for this viewer. In their own
 * copy: a draft or an answer, while they Interact and the agent isn't driving
 * it (the agent mustn't answer its own question). On a live page, which every
 * viewer's canvas hears from: a draft or an answer only while they have
 * control, so only the controller's canvas speaks (only their input reaches
 * the shared page) and the question is answered once. The runtime checks for
 * the tap too, but page script could post the message itself.
 */
export function pageVoice(viewer: MockupViewer): PageVoice {
  if (viewer.live) {
    const speaks = viewer.liveDriver.kind === "you"
    return { draft: speaks, answer: speaks }
  }
  const speaks = viewer.focused && viewer.driver.kind !== "agent"
  return { draft: speaks, answer: speaks }
}

/**
 * Whether a tap on the page can answer its question at all, which the page is
 * told (`answerable`) so it keeps a pick it can't send on the page and says to
 * answer in the chat, rather than showing it as the card's answer. On a live
 * page, while a person has control (#1688): every viewer's canvas tells the
 * one shared page, so this reads only shared state and is the same for each,
 * whoever has control; {@link pageVoice} picks the one canvas that sends. Not
 * while nobody can tap, nor while the agent drives. In their own copy, unless
 * the agent drives it. Unlike `pageVoice`, focus doesn't count: nothing
 * reaches a page they aren't interacting with, and the page shouldn't change
 * as they start to.
 */
export function pageAnswers(viewer: MockupViewer): boolean {
  if (viewer.live) {
    const kind = viewer.liveDriver.kind
    return kind === "you" || kind === "person"
  }
  return viewer.driver.kind !== "agent"
}
