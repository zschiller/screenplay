"use client"

import { useRef, useState, useTransition } from "react"
import { Check, MoreHorizontal } from "lucide-react"
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

import { useNow } from "@/hooks/use-now"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"
import { appendCommentAction, editCommentAction } from "@/lib/comments-actions"
import {
  canDeleteComment,
  canDeleteThread,
  canEditComment,
} from "@/lib/comment-permissions"
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
 * Each thread's pin number: its place in the order threads were started,
 * counting resolved ones, so a thread keeps its number for its whole life.
 */
export function threadNumbers(
  threads: readonly { id: string; createdAt: number }[]
): Map<string, number> {
  const ordered = [...threads].sort((a, b) => a.createdAt - b.createdAt)
  return new Map(ordered.map((t, i) => [t.id, i + 1]))
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
          : "bg-canvas-comment text-white",
        className
      )}
    >
      {resolved ? <Check className="size-3.5" /> : number}
      {unread && !resolved && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-background bg-info"
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
}) {
  const [reply, setReply] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // Everyone who has commented is a member too, so their names highlight
  // even before the member list arrives.
  const memberNames = [
    ...members.map((m) => m.name),
    ...thread.comments.map((c) => c.authorName),
  ]
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {place && <PlaceChip place={place} />}
        <div className="ml-auto flex shrink-0 items-center">
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={thread.resolved ? onReopen : onResolve}
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Thread actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
      <div className="-mx-3 flex max-h-72 flex-col gap-3 overflow-y-auto px-3">
        {thread.comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
            members={members}
            memberNames={memberNames}
            onDelete={() => onDeleteComment(c.id)}
          />
        ))}
      </div>
      {thread.resolved ? (
        <ResolvedNote resolvedAt={thread.resolvedAt} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <MentionTextarea
            rows={2}
            placeholder="Reply…"
            value={reply}
            onChange={(v) => {
              setReply(v)
              setError(null)
            }}
            members={members}
            onSubmit={submitReply}
          />
          <ComposerFooter error={error}>
            <Button
              size="xs"
              onClick={submitReply}
              disabled={pending || !reply.trim()}
            >
              Reply
            </Button>
          </ComposerFooter>
        </div>
      )}
    </div>
  )

  function submitReply() {
    const text = reply.trim()
    if (!text || pending) return
    start(async () => {
      try {
        await appendCommentAction({ threadId: thread.id, body: text })
        setReply("")
      } catch (e) {
        console.error("appendComment failed:", e)
        setError("Couldn't send. Try again.")
      }
    })
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
      <Check className="size-3.5" />
      {resolvedAt ? `Resolved ${formatAgo(resolvedAt, now)}` : "Resolved"}
    </p>
  )
}

function CommentRow({
  comment,
  currentUserId,
  members,
  memberNames,
  onDelete,
}: {
  comment: CommentRecord
  currentUserId: string | null
  members: CommentMember[]
  memberNames: string[]
  onDelete: () => void
}) {
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const canEdit = canEditComment(comment, currentUserId)
  const canDelete = canDeleteComment(comment, currentUserId)
  return (
    <div className="group flex items-start gap-2" data-comment-id={comment.id}>
      <Avatar name={comment.authorName} avatar={comment.authorAvatar} />
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
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setDraft(comment.body)
                      setError(null)
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
              onChange={(v) => {
                setDraft(v)
                setError(null)
              }}
              members={members}
              onSubmit={save}
              onEscape={() => setEditing(false)}
            />
            <ComposerFooter error={error}>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={save}
                disabled={pending || !draft.trim()}
              >
                Save
              </Button>
            </ComposerFooter>
          </div>
        ) : (
          <CommentBody body={comment.body} memberNames={memberNames} />
        )}
      </div>
    </div>
  )

  function save() {
    const text = draft.trim()
    if (!text || pending) return
    if (text === comment.body) {
      setEditing(false)
      return
    }
    start(async () => {
      try {
        await editCommentAction({ commentId: comment.id, body: text })
        setEditing(false)
      } catch (e) {
        console.error("editComment failed:", e)
        setError("Couldn't save. Try again.")
      }
    })
  }
}

/** A comment's text with @mentions of room members set in medium weight. */
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
          <span key={i} className="font-medium text-info">
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
 * The row under every comment text box: the buttons on the right, and what
 * went wrong on the left when the last send failed.
 */
export function ComposerFooter({
  error,
  children,
}: {
  error: string | null
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-6 items-center justify-end gap-2">
      {error && (
        <p role="alert" className="mr-auto min-w-0 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex shrink-0 gap-1">{children}</div>
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
          className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-md bg-popover p-1 shadow-md ring-1 ring-foreground/10"
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
