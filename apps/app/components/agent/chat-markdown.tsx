"use client"

import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import Markdown, { type Components, type UrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { CheckIcon, CopyIcon } from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The one markdown renderer every chat message kind goes through — assistant,
 * user, plan, plan feedback, and reasoning. Agent replies are markdown-heavy, so
 * this renders GitHub-flavoured markdown (tables, task lists, strikethrough),
 * inline code as the same chip the Document editor uses, and fenced code with
 * theme-aware syntax highlighting and a copy button. Code blocks and tables
 * scroll horizontally inside the message rather than widening the panel.
 *
 * The prose styling lives here and in the `.chat-markdown` rules in
 * `app/globals.css`, so the message kinds can't drift apart again. A kind picks
 * a `tone` (its colours) and a `size` (its type scale); nothing else varies.
 */

export type ChatMarkdownTone =
  /** Body text on the panel background: assistant replies, plans. */
  | "default"
  /** De-emphasised supporting text: reasoning, plan feedback. */
  | "muted"
  /** On the soft `muted` fill of the sent user bubble. */
  | "bubble"

const PROSE_CLASS =
  "prose prose-sm max-w-none prose-neutral prose-headings:my-1.5 prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0.5 prose-blockquote:my-1.5 prose-hr:my-3"

const TONE_CLASS: Record<ChatMarkdownTone, string> = {
  default: "text-foreground dark:prose-invert",
  muted: "text-muted-foreground dark:prose-invert",
  // Code chips and blocks take a slightly deeper fill (`.chat-markdown-bubble`
  // in globals.css), or they vanish into the bubble's own muted fill.
  bubble: "chat-markdown-bubble text-foreground dark:prose-invert",
}

const SIZE_CLASS = {
  sm: "text-sm",
  xs: "text-xs",
} as const

const REMARK_PLUGINS = [remarkGfm]
// `detect: false` — highlight only fences that name a language. Guessing turns
// plain output (a log, a path list) into confetti.
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false }]] as ComponentProps<
  typeof Markdown
>["rehypePlugins"]

export function ChatMarkdown({
  children,
  tone = "default",
  size = "sm",
  components,
  urlTransform,
  className,
}: {
  children: string
  tone?: ChatMarkdownTone
  size?: keyof typeof SIZE_CLASS
  /** Per-kind overrides (the user bubble's mention/element links). */
  components?: Components
  urlTransform?: UrlTransform
  className?: string
}) {
  const merged = useMemo<Components>(
    () => ({ ...BASE_COMPONENTS, ...components }),
    [components]
  )

  return (
    <div
      className={cn(
        "chat-markdown min-w-0",
        PROSE_CLASS,
        TONE_CLASS[tone],
        SIZE_CLASS[size],
        className
      )}
    >
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={merged}
        urlTransform={urlTransform}
      >
        {children}
      </Markdown>
    </div>
  )
}

const BASE_COMPONENTS: Components = {
  pre: ({ node: _node, children, ...props }) => (
    <CodeBlock {...props}>{children}</CodeBlock>
  ),
  table: ({ node: _node, ...props }) => (
    <div className="chat-markdown-scroll">
      <table {...props} />
    </div>
  ),
}

/** The fence's language, off the `language-*` class on its inner `<code>`. */
function fenceLanguage(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(children)) return null
  const match = /(?:^|\s)language-(\S+)/.exec(children.props.className ?? "")
  return match ? match[1] : null
}

function CodeBlock({
  children,
  ...props
}: ComponentProps<"pre"> & { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const language = fenceLanguage(children)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? ""
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""))
      setCopied(true)
    } catch {
      // Clipboard denied (no user gesture / insecure context): nothing to undo.
    }
  }

  return (
    <div className="chat-markdown-codeblock">
      <div className="chat-markdown-codeblock-header">
        <span>{language ?? ""}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          className="chat-markdown-copy"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      </div>
      <pre ref={preRef} {...props}>
        {children}
      </pre>
    </div>
  )
}
