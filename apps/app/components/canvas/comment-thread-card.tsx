"use client"

import { useRef, useState } from "react"
import {
  CheckIcon,
  ClockIcon,
  DotsThreeIcon,
  RobotIcon,
} from "@workspace/ui/components/icons"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import { AgentActivityDots } from "@/components/agent-activity-dots"
import { useNow } from "@/hooks/use-now"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"
import { isWithAgent, shortCommit } from "@/lib/comments-agent"
import { useViewing } from "@/lib/viewer/context"
import {
  canDeleteComment,
  canDeleteThread,
  canEditComment,
  canResolveThread,
} from "@/lib/comment-permissions"
export { threadNumbers } from "@/lib/comments-panel"
import {
  activeMentionQuery,
  insertMention,
  matchMembers,
  splitMentions,
} from "@/lib/comment-mentions"

/** A room member someone can @mention. */
export interface CommentMember {
  userId: string
  name: string
  avatar: string | null
}

/**
 * The comment pin: a numbered teardrop in the comment colour whose
 * bottom-left tip is the point it marks. Resolved threads, shown only while
 * opened from the thread list, go neutral with a tick in place of the number.
 */
export function CommentPinMark({
  number,
  unread = false,
  resolved = false,
  className,
}: {
  number: number | null
  unread?: boolean
  resolved?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "relative flex size-6.5 items-center justify-center rounded-[13px_13px_13px_3px] text-xs font-semibold tabular-nums shadow-md",
        resolved
          ? "bg-muted-foreground text-background"
          : "bg-canvas-comment text-black",
        className
      )}
    >
      {resolved ? <CheckIcon className="size-3.5" /> : number}
      {unread && !resolved && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-background bg-info-fill"
        />
      )}
    </span>
  )
}

/**
 * The thread card: a 250px popover beside the element it's about. A chip
 * names the route and element, then the comments, then a reply box. Resolved
 * threads read the same with Reopen in place of Resolve and no reply box.
 */
export function ThreadCard({
  thread,
  place,
  quote,
  currentUserId,
  members,
  onResolve,
  onReopen,
  onMarkUnread,
  onDeleteThread,
  onDeleteComment,
  onReply,
  onEditComment,
  onSendToAgent,
}: {
  thread: ThreadWithComments
  /** What the thread is about, e.g. "/checkout · aside#summary". */
  place: string | null
  /** A quoted document range, rendered under the header. */
  quote?: React.ReactNode
  currentUserId: string | null
  members: CommentMember[]
  onResolve: () => void
  onReopen: () => void
  onMarkUnread: () => void
  onDeleteThread: () => void
  onDeleteComment: (commentId: string) => void
  /** Save a reply or an edit; false when it wasn't saved (and the failure
   *  has been shown), so the text typed isn't lost. */
  onReply: (body: string) => Promise<boolean>
  onEditComment: (commentId: string, body: string) => Promise<boolean>
  /** Ask the Workspace's agent to address the thread (#788), when it can. */
  onSendToAgent?: () => void
}) {
  const [reply, setReply] = useState("")
  // A viewer resolves only the threads they started (#1934).
  const viewing = !!useViewing()
  const canResolve = canResolveThread(thread, currentUserId, {
    viewer: viewing,
  })
  // Everyone who has commented is a member too, so their names highlight
  // even before the member list arrives.
  const memberNames = [
    ...members.map((m) => m.name),
    ...thread.comments.map((c) => c.authorName),
  ]
  // The agent's latest reply carries the thread's Addressed chip.
  const lastAgentReply = [...thread.comments].reverse().find((c) => c.fromAgent)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {place && <PlaceChip place={place} />}
        <div className="ml-auto flex shrink-0 items-center">
          {canResolve && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={thread.resolved ? onReopen : onResolve}
            >
              {thread.resolved ? "Reopen" : "Resolve"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Thread actions">
                <DotsThreeIcon />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onSendToAgent && (
                <DropdownMenuItem onSelect={onSendToAgent}>
                  Send to agent
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onMarkUnread}>
                Mark as unread
              </DropdownMenuItem>
              {canDeleteThread(thread, currentUserId) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={onDeleteThread}
                  >
                    Delete thread
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {quote}
      <div
        className="-mx-3 flex max-h-72 flex-col gap-3 overflow-y-auto px-3"
        data-selectable-text
      >
        {thread.comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
            members={members}
            memberNames={memberNames}
            status={
              c.id === lastAgentReply?.id &&
              thread.agentStatus === "addressed" ? (
                <AgentStatusChip
                  status="addressed"
                  commit={thread.agentCommit}
                />
              ) : null
            }
            onDelete={() => onDeleteComment(c.id)}
            onEdit={(body) => onEditComment(c.id, body)}
          />
        ))}
        {isWithAgent(thread) && thread.agentStatus && (
          <AgentPendingRow status={thread.agentStatus} />
        )}
      </div>
      {thread.resolved ? (
        <ResolvedNote resolvedAt={thread.resolvedAt} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <MentionTextarea
            rows={2}
            placeholder="Reply…"
            value={reply}
            onChange={setReply}
            members={members}
            onSubmit={submitReply}
          />
          <ComposerFooter>
            <Button size="sm" onClick={submitReply} disabled={!reply.trim()}>
              Reply
            </Button>
          </ComposerFooter>
        </div>
      )}
    </div>
  )

  async function submitReply() {
    const text = reply.trim()
    if (!text) return
    // The reply shows in the thread at once; a failed one comes back here.
    setReply("")
    if (!(await onReply(text))) setReply((now) => now || text)
  }
}

/** What a thread is about: the route and element, or a document's title. */
export function PlaceChip({ place }: { place: string }) {
  return (
    <span
      className="inline-flex h-5 max-w-full min-w-0 items-center rounded-md bg-muted px-1.5 text-xs text-muted-foreground"
      title={place}
    >
      <span className="truncate">{place}</span>
    </span>
  )
}

/** Stands in for the reply box on a resolved thread. */
function ResolvedNote({ resolvedAt }: { resolvedAt: number | null }) {
  const now = useNow()
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CheckIcon className="size-3.5" />
      {resolvedAt ? `Resolved ${formatAgo(resolvedAt, now)}` : "Resolved"}
    </p>
  )
}

function CommentRow({
  comment,
  currentUserId,
  members,
  memberNames,
  status,
  onDelete,
  onEdit,
}: {
  comment: CommentRecord
  currentUserId: string | null
  members: CommentMember[]
  memberNames: string[]
  /** The agent's status chip, under its latest reply. */
  status?: React.ReactNode
  onDelete: () => void
  onEdit: (body: string) => Promise<boolean>
}) {
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const canEdit = canEditComment(comment, currentUserId)
  const canDelete = canDeleteComment(comment, currentUserId)
  return (
    <div className="group flex items-start gap-2" data-comment-id={comment.id}>
      {comment.fromAgent ? (
        <AgentAvatar />
      ) : (
        <Avatar name={comment.authorName} avatar={comment.authorAvatar} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex h-5 items-center gap-1.5">
          <span className="truncate font-medium">{comment.authorName}</span>
          <time
            className="shrink-0 text-xs text-muted-foreground"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={new Date(comment.createdAt).toLocaleString()}
          >
            {formatRelative(comment.createdAt, now)}
          </time>
          {comment.editedAt && (
            <span className="shrink-0 text-xs text-muted-foreground">
              · edited
            </span>
          )}
          {(canEdit || canDelete) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label="Comment actions"
                  className="-my-1 ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <DotsThreeIcon />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setDraft(comment.body)
                      setEditing(true)
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <MentionTextarea
              autoFocus
              rows={2}
              value={draft}
              onChange={setDraft}
              members={members}
              onSubmit={save}
              onEscape={() => setEditing(false)}
            />
            <ComposerFooter>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={!draft.trim()}>
                Save
              </Button>
            </ComposerFooter>
          </div>
        ) : (
          <CommentBody body={comment.body} memberNames={memberNames} />
        )}
        {status && <div className="mt-1">{status}</div>}
      </div>
    </div>
  )

  async function save() {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    if (text === comment.body) return
    // The new text shows at once; a failed edit reopens with it.
    if (!(await onEdit(text))) {
      setDraft(text)
      setEditing(true)
    }
  }
}

/**
 * A comment's text with @mentions of room members set in medium weight, in
 * the text colour, like every inline reference.
 */
function CommentBody({
  body,
  memberNames,
}: {
  body: string
  memberNames: string[]
}) {
  return (
    <p className="break-words whitespace-pre-wrap">
      {splitMentions(body, memberNames).map((seg, i) =>
        seg.mention ? (
          <span key={i} className="font-medium">
            {seg.text}
          </span>
        ) : (
          seg.text
        )
      )}
    </p>
  )
}

/**
 * The row under every comment text box: its buttons, on the right. A failed
 * send says so in a toast (see `useCommentThreads`).
 */
export function ComposerFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-end gap-1">
      {children}
    </div>
  )
}

/**
 * A comment text box with an @mention picker. Typing `@` lists matching
 * room members above the box; arrows move, Enter or Tab picks, Esc closes.
 * Cmd/Ctrl+Enter submits (or plain Enter when `submitOnEnter`).
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  onSubmit,
  onEscape,
  submitOnEnter = false,
  rows,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  members: CommentMember[]
  onSubmit: () => void
  onEscape?: () => void
  submitOnEnter?: boolean
  rows?: number
  placeholder?: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(0)
  const mention = activeMentionQuery(value, caret)
  const matches =
    mention && mention.start !== dismissedAt
      ? matchMembers(members, mention.query)
      : []
  const open = matches.length > 0
  const active = Math.min(highlight, matches.length - 1)

  function pick(member: CommentMember) {
    if (!mention) return
    const next = insertMention(value, mention.start, caret, member.name)
    onChange(next.text)
    setCaret(next.caret)
    setHighlight(0)
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <div className="relative">
      {open && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {matches.map((m, i) => (
            <li
              key={m.userId}
              role="option"
              aria-selected={i === active}
              className={cn(
                "flex cursor-default items-center gap-2 rounded-sm px-1.5 py-1",
                i === active && "bg-accent text-accent-foreground"
              )}
              onPointerDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              onPointerEnter={() => setHighlight(i)}
            >
              <Avatar name={m.name} avatar={m.avatar} />
              <span className="truncate">{m.name}</span>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={ref}
        autoFocus={autoFocus}
        rows={rows}
        className="max-h-40 min-h-8 resize-none py-1.5 focus-visible:ring-0"
        placeholder={placeholder}
        value={value}
        aria-expanded={open}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          setDismissedAt(null)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const step = e.key === "ArrowDown" ? 1 : -1
              setHighlight((active + step + matches.length) % matches.length)
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              pick(matches[active]!)
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              e.stopPropagation()
              setDismissedAt(mention!.start)
              return
            }
          }
          if (e.key === "Escape" && onEscape) {
            e.preventDefault()
            e.stopPropagation()
            onEscape()
            return
          }
          if (e.key !== "Enter") return
          if (submitOnEnter ? !e.shiftKey : e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
    </div>
  )
}

/**
 * Where a thread sent to the agent stands (#788): Queued, Agent working, or
 * Addressed with the commit the agent made.
 */
export function AgentStatusChip({
  status,
  commit,
  besideAgent = false,
  className,
}: {
  status: NonNullable<ThreadWithComments["agentStatus"]>
  commit?: string | null
  /** Next to the agent's name, which already says who is working. */
  besideAgent?: boolean
  className?: string
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-5 shrink-0 gap-1 px-1.5 py-0 font-normal text-muted-foreground",
        className
      )}
    >
      {status === "queued" ? (
        <>
          <ClockIcon aria-hidden className="size-3" />
          Queued
        </>
      ) : status === "working" ? (
        <>
          <AgentActivityDots className="size-3" />
          {besideAgent ? "Working" : "Agent working"}
        </>
      ) : (
        <>
          <CheckIcon aria-hidden className="size-3 text-success" />
          Addressed
          {commit && (
            <span className="font-mono" title={commit}>
              {shortCommit(commit)}
            </span>
          )}
        </>
      )}
    </Badge>
  )
}

/** The agent's place in a thread while it's on the request. */
function AgentPendingRow({
  status,
}: {
  status: NonNullable<ThreadWithComments["agentStatus"]>
}) {
  return (
    <div className="flex items-center gap-2">
      <AgentAvatar />
      <span className="font-medium">Agent</span>
      <AgentStatusChip status={status} besideAgent />
    </div>
  )
}

function AgentAvatar() {
  return (
    <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <RobotIcon aria-hidden className="size-3" />
    </div>
  )
}

export function PillAvatar({
  name,
  avatar,
}: {
  name: string
  avatar: string | null
}) {
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt={name} className="size-6 rounded-full" />
    )
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase()
  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initial}
    </div>
  )
}

function Avatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt={name} className="size-5 shrink-0 rounded-full" />
    )
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase()
  return (
    <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initial}
    </div>
  )
}

/** `formatRelative` as a phrase: "4m ago", "just now", or a date. */
function formatAgo(ts: number, now: number): string {
  const rel = formatRelative(ts, now)
  return /^\d+[mhd]$/.test(rel) ? `${rel} ago` : rel
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return "just now"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(ts).toLocaleDateString()
}
