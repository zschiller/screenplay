import { isBranchBusy, type BranchBusyChat } from "@/lib/branch-busy"
import type { BranchData, ChatSessionData, PlanData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

/**
 * Workspace State (#1247): everything a Workspace shows about itself, worked
 * out once from its Branch and the Room's Chat Sessions and plans. Its label,
 * its status line (the words and glyph behind its state icon), the Workspaces
 * menu section it sits in, and whether it needs you. Mentions, the hover card,
 * the Getting started checklist, the Canvas list and the Chats menu read
 * it, so a Workspace reads the same everywhere; callers never build the facts
 * themselves. The status line, section and needs-you rules live here and
 * nowhere else.
 *
 * The status line says what the Workspace is doing right now: the setup step
 * it's on, that its agent is working, that it needs you, that it's ready,
 * stopped or Done (#976), or that setup failed. Its PR is not a state: rows
 * show it at their end (#963), except that a PR which can't merge needs you.
 *
 * Needs you means the person has to act: a plan waiting for approval, a
 * question card waiting for an answer, a PR whose merge is blocked, or (as
 * the error line) a failed setup. An open,
 * healthy PR waits on its reviewers, so it's Ready.
 *
 * Pure, so `workspace-state.test.ts` asserts it from one fixture table with no
 * React. `useWorkspaceStates` is the hook that feeds it the Room doc.
 */

/** The slice of a Branch the status line reads. {@link BranchData} satisfies it. */
type StatusLineBranch = Pick<
  BranchData,
  "status" | "statusMessage" | "error" | "doneAt" | "prState" | "prBlocked"
>

interface StatusLineContext {
  /** A chat turn is in flight on this Workspace. */
  agentWorking: boolean
  /** One of this Workspace's plans waits for approval. */
  planPending?: boolean
  /** Its chat asked a question and waits for the answer. */
  questionPending?: boolean
}

export type WorkspaceStatusLine =
  /** Provisioning or recovering. `step` is the current step, without the
   *  trailing ellipsis; the row appends the elapsed time. */
  | { kind: "progress"; step: string }
  /** Setup (or a recovery) failed. `title` names what failed, for the detail
   *  card; `detail` is the raw error. */
  | { kind: "error"; title: string; detail: string }
  | {
      kind: "idle"
      state: "working" | "needs-you" | "ready" | "stopped" | "done"
      text: string
    }

/** "Installing dependencies…" → "Installing dependencies". */
function stepLabel(message: string | undefined): string {
  return (message ?? "")
    .trim()
    .replace(/(…|\.\.\.)$/, "")
    .trim()
}

/**
 * What failed, for the detail card's title. The server keeps the step that was
 * running when it wrote the error, so a failed install reads "Installing
 * dependencies failed"; with no step on record it falls back to "Setup failed".
 */
function failureTitle(message: string | undefined): string {
  const step = stepLabel(message)
  return step ? `${step} failed` : "Setup failed"
}

function workspaceStatusLine(
  branch: StatusLineBranch,
  ctx: StatusLineContext
): WorkspaceStatusLine {
  // Done is the member's word on the Workspace, so it wins over the sandbox.
  if (branch.doneAt) return { kind: "idle", state: "done", text: "Done" }
  if (branch.status === "error" || branch.error) {
    return {
      kind: "error",
      title: failureTitle(branch.statusMessage),
      detail: branch.error || "No details were recorded.",
    }
  }
  if (branch.status === "creating" || branch.status === "starting") {
    return {
      kind: "progress",
      step:
        stepLabel(branch.statusMessage) ||
        (branch.status === "creating"
          ? "Setting up the workspace"
          : "Starting"),
    }
  }
  const needsYou: WorkspaceStatusLine | null = ctx.planPending
    ? { kind: "idle", state: "needs-you", text: "Plan waiting for approval" }
    : ctx.questionPending
      ? { kind: "idle", state: "needs-you", text: "Question waiting" }
      : branch.prState === "open" && branch.prBlocked
        ? { kind: "idle", state: "needs-you", text: "Merge blocked" }
        : null
  // A stopped sandbox still waits on the person for its plan, question or PR.
  if (branch.status === "stopped")
    return needsYou ?? { kind: "idle", state: "stopped", text: "Stopped" }
  if (ctx.agentWorking)
    return { kind: "idle", state: "working", text: "Agent working" }
  if (needsYou) return needsYou
  return { kind: "idle", state: "ready", text: "Ready" }
}

/**
 * Whether the Workspace's state glyph is the setup spinner: it's creating or
 * starting, and neither Done nor failed.
 */
export function workspaceSettingUp(branch: StatusLineBranch): boolean {
  return (
    workspaceStatusLine(branch, { agentWorking: false }).kind === "progress"
  )
}

/**
 * Whether the Workspace's agent can take a turn: its sandbox runs, or it's
 * still setting up but its code is checked out (the install and dev server
 * finish behind the agent).
 */
export function agentCanStart(
  branch: Pick<BranchData, "status" | "codeReady">
): boolean {
  return (
    branch.status === "running" ||
    (branch.status === "creating" && branch.codeReady === true)
  )
}

/**
 * Whether the Workspace is still setting up with nothing for its agent yet:
 * creating before its code is checked out, or starting.
 */
export function workspaceBooting(
  branch: Pick<BranchData, "status" | "codeReady">
): boolean {
  return (
    (branch.status === "creating" || branch.status === "starting") &&
    !agentCanStart(branch)
  )
}

/** The Workspaces with a plan waiting for approval, from the room's plans. */
function planPendingBranchIds(
  plans: readonly Pick<PlanData, "branchId" | "status">[]
): Set<string> {
  return new Set(
    plans.filter((p) => p.status === "pending").map((p) => p.branchId)
  )
}

/** Elapsed time for a progress step: "8s", "40s", "2m 05s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${String(s).padStart(2, "0")}s`
}

/** The live state sections of the Chats menu. Done keeps its own. */
export type WorkspaceSection = "working" | "needs-you" | "idle"

/**
 * Which live section a (not Done) Workspace sits in, from its status line: an
 * agent working or setup running is Working; a failed setup, a plan waiting
 * for approval, a question waiting for its answer or a blocked PR is Needs
 * you; anything else, an open PR
 * waiting on review included, is Idle.
 */
function sectionOf(line: WorkspaceStatusLine): WorkspaceSection {
  if (line.kind === "progress") return "working"
  if (line.kind === "error") return "needs-you"
  if (line.state === "working") return "working"
  return line.state === "needs-you" ? "needs-you" : "idle"
}

/** The slice of a Branch Workspace State reads. {@link BranchData} satisfies it. */
export type WorkspaceStateBranch = StatusLineBranch &
  Pick<BranchData, "id" | "title">

export interface WorkspaceState {
  /** Its name: the title, or "New Workspace". */
  label: string
  line: WorkspaceStatusLine
  /** A chat turn is in flight on it, whatever its line says. */
  agentWorking: boolean
  /** Its Chats menu section; Done keeps its own. */
  section: WorkspaceSection | "done"
  /** A plan to approve, a question to answer, a blocked merge or a failed
   *  setup waits on you. */
  needsYou: boolean
}

/**
 * The Room's facts about its Workspaces, read from its Chat Sessions, plans
 * and transcripts in one pass: which have a turn in flight, which have a plan
 * waiting for approval and which have a question waiting for its answer.
 */
export interface RoomWorkspaceFacts {
  busy: ReadonlySet<string>
  planPending: ReadonlySet<string>
  questionPending: ReadonlySet<string>
}

const NO_CHATS: ReadonlySet<string> = new Set()

/**
 * `openQuestions` are the chats, by id, whose transcript ends on a question
 * card nobody has answered (`hasOpenQuestion` in `lib/agent/question.ts`).
 * Transcripts live in the chat store, not the Room doc, so the caller reads
 * them (`useOpenQuestionChats`) and passes the ids in.
 */
export function roomWorkspaceFacts(
  chats: readonly (BranchBusyChat & { id?: string })[],
  plans: readonly Pick<PlanData, "branchId" | "status">[],
  openQuestions: ReadonlySet<string> = NO_CHATS
): RoomWorkspaceFacts {
  const busy = new Set<string>()
  const questionPending = new Set<string>()
  for (const chat of chats) {
    if (!chat.branchId) continue
    if (isBranchBusy(chat.branchId, [chat])) busy.add(chat.branchId)
    if (chat.id && !chat.closedAt && openQuestions.has(chat.id))
      questionPending.add(chat.branchId)
  }
  return { busy, planPending: planPendingBranchIds(plans), questionPending }
}

export function workspaceState(
  branch: WorkspaceStateBranch,
  room: RoomWorkspaceFacts
): WorkspaceState {
  const context = {
    agentWorking: room.busy.has(branch.id),
    planPending: room.planPending.has(branch.id),
    questionPending: room.questionPending.has(branch.id),
  }
  const line = workspaceStatusLine(branch, context)
  const section = branch.doneAt ? "done" : sectionOf(line)
  return {
    label: workspaceLabel(branch),
    line,
    agentWorking: context.agentWorking,
    section,
    needsYou: section === "needs-you",
  }
}

/**
 * A Sketch Chat's status line: with no Branch it has no setup, PR or plan, so
 * only a turn in flight ("Agent working") or a question waiting on you set it,
 * read the way a Workspace reads them. `openQuestions` is as for
 * {@link roomWorkspaceFacts}.
 */
export function sketchChatStatusLine(
  chat: Pick<ChatSessionData, "id" | "closedAt" | "isStreaming">,
  openQuestions: ReadonlySet<string> = NO_CHATS
): WorkspaceStatusLine {
  if (chat.closedAt) return { kind: "idle", state: "ready", text: "Ready" }
  if (chat.isStreaming)
    return { kind: "idle", state: "working", text: "Agent working" }
  if (openQuestions.has(chat.id))
    return { kind: "idle", state: "needs-you", text: "Question waiting" }
  return { kind: "idle", state: "ready", text: "Ready" }
}

/**
 * Whether any Workspace needs the member (#1152): at least one that isn't Done
 * sits in Needs you. It drives the dot on the Chats button.
 */
export function anyWorkspaceNeedsYou<T extends WorkspaceStateBranch>(
  branches: readonly T[],
  stateOf: (branch: T) => WorkspaceState
): boolean {
  return branches.some((b) => stateOf(b).needsYou)
}
