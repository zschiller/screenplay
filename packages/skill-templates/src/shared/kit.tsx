// The pieces every template page is built from, so the four pages read as one
// product. One rule per job:
// - Navigation is line tabs in the bar pinned to the top (Shell).
// - Choosing among a few short values is a segmented ToggleGroup (Segmented).
// - Answering a question with labelled options is the chat card's rows
//   (Choices, choices.tsx).
// - Colour carries meaning only: status inks on severity and outcome badges,
//   and magenta for one thing, the recommendation (Rec). Ids, labels, counts
//   and rules stay ink and grey.

import * as React from "react"
import { flushSync } from "react-dom"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { CaretRightIcon } from "@workspace/ui/components/icons"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { Html, Label, WIDE } from "./page.tsx"
import { ThemeButton, ThemeContext } from "./theme.tsx"
import { Lightbox } from "./shots.tsx"

/** The column every page reads in, and its bottom bar matches. */
export const WIDTH = "832px"

export type Tab = { value: string; label: string; count?: number }

/**
 * The page frame: a bar pinned to the top with the title, the page's tabs
 * and the theme switch, then the column. On a phone the tabs take a second
 * row that scrolls sideways, fading where it hides tabs.
 */
export function Shell({
  title,
  tabs,
  tab,
  setTab,
  tabsLabel,
  theme: [dark, toggleTheme],
  bar,
  wide,
  children,
}: {
  /** From 1024px the page is 1184px wide (pass `wide` to its CopyBar too) */
  wide?: boolean
  title: string
  tabs: Tab[]
  tab: string
  setTab: (tab: string) => void
  tabsLabel: string
  /** useTheme(), called by the page, whose captures follow it too */
  theme: readonly [boolean, () => void]
  /** The bottom bar (CopyBar). */
  bar: React.ReactNode
  children: React.ReactNode
}) {
  const fade = useEdgeFade<HTMLDivElement>()
  // Its height, as --top-bar, for whatever sticks under it
  const top = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const el = top.current!
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--top-bar",
        el.offsetHeight + "px"
      )
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <ThemeContext.Provider value={dark}>
      <Lightbox>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="gap-6 pb-[calc(112px+env(safe-area-inset-bottom,0px))]"
        >
          {/* Edge to edge, as the bottom bar is */}
          <div
            ref={top}
            className="sticky top-[env(safe-area-inset-top,0px)] z-[6] border-b bg-background px-4 md:px-6"
          >
            <div
              className={cn(
                "mx-auto flex flex-wrap items-center gap-x-4 md:flex-nowrap",
                wide && WIDE
              )}
              style={{ maxWidth: WIDTH }}
            >
              <h1
                title={title}
                className="min-w-0 flex-1 truncate py-3 font-heading text-title-sm"
              >
                {title}
              </h1>
              <span className="flex md:order-last">
                <ThemeButton dark={dark} toggle={toggleTheme} />
              </span>
              <div
                ref={fade.ref}
                onScroll={fade.onScroll}
                style={fade.style}
                className="order-last -mt-1 w-full min-w-0 [scrollbar-width:none] overflow-x-auto md:order-none md:mt-0 md:w-auto md:max-w-[60%] [&::-webkit-scrollbar]:hidden"
              >
                <TabsList
                  variant="line"
                  aria-label={tabsLabel}
                  className="h-auto flex-none gap-4 rounded-none p-0 pt-0 pb-[5px] md:py-[5px]"
                >
                  {tabs.map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className="h-full flex-none px-0"
                    >
                      {t.label}
                      {t.count != null && (
                        <span className="font-normal text-muted-foreground tabular-nums">
                          {t.count}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </div>
          </div>
          <div
            className={cn(
              "mx-auto flex w-full max-w-[880px] flex-col gap-6 px-4 md:px-6",
              wide && "lg:max-w-[1232px]"
            )}
          >
            {children}
          </div>
        </Tabs>
        {bar}
      </Lightbox>
    </ThemeContext.Provider>
  )
}

/**
 * What the page is: a grey meta line (kind · date · round), the owner's
 * words, and any lede and links. At the top of a page you read; under the
 * work on a page you step through.
 */
export function Intro({
  meta,
  quote,
  children,
  className,
}: {
  meta: string
  quote?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex max-w-[72ch] flex-col gap-2.5 text-sm text-muted-foreground",
        className
      )}
    >
      <Label>{meta}</Label>
      {quote && <Quote>{quote}</Quote>}
      {children}
    </div>
  )
}

export function Quote({
  className,
  ...props
}: React.ComponentProps<"blockquote">) {
  return (
    <blockquote
      className={cn(
        "m-0 max-w-[68ch] border-l-2 pl-3 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/** Links under a lede, dot separated. */
export function Links({ links }: { links: [string, string][] }) {
  if (!links.length) return null
  return (
    <p>
      {links.map(([t, u], i) => (
        <React.Fragment key={u + i}>
          {i > 0 && " · "}
          <a href={u} className="text-foreground underline">
            {t}
          </a>
        </React.Fragment>
      ))}
    </p>
  )
}

/** A group's heading: a depth, a surface, a question with options. */
export function SectionHead({
  eyebrow,
  title,
  blurb,
  className,
}: {
  eyebrow?: string
  title?: string
  blurb?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1 border-b pb-3", className)}>
      {eyebrow && <Label>{eyebrow}</Label>}
      {title && (
        <h2 className="m-0 font-heading text-title-md text-balance">{title}</h2>
      )}
      {blurb && <div className="text-sm text-muted-foreground">{blurb}</div>}
    </div>
  )
}

/** One thing to answer: its id, its title, and where it comes from. */
export function ItemHead({
  id,
  title,
  meta,
  as: As = "h3",
  large,
}: {
  id?: string
  title: string
  meta?: string
  as?: "h2" | "h3"
  /** An option's name, which reads as a heading over its captures */
  large?: boolean
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2.5">
        {id && (
          <span className="flex-none font-mono text-sm font-semibold">
            {id}
          </span>
        )}
        <As
          className={cn(
            "m-0 text-balance",
            large ? "font-heading text-title-sm" : "text-sm font-medium"
          )}
        >
          {title}
        </As>
      </div>
      {meta && (
        <span className="font-mono text-xs text-muted-foreground">{meta}</span>
      )}
    </header>
  )
}

/** The recommendation: the one place the pages use the magenta accent. */
export function Rec({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("text-info", className)}>
      Recommended
    </Badge>
  )
}

/** The recommendation as a dot, where a badge won't fit (option letters). */
export function RecDot() {
  return (
    <span
      aria-label="recommended"
      className="size-1.5 flex-none rounded-full bg-info"
    />
  )
}

const TONE = {
  plain: "",
  high: "text-destructive",
  medium: "text-warning",
  done: "text-success",
  no: "text-destructive",
}

/** A fact about an item. Coloured only when the colour means something. */
export function Tag({
  tone = "plain",
  className,
  ...props
}: React.ComponentProps<typeof Badge> & { tone?: keyof typeof TONE }) {
  return (
    <Badge
      variant="outline"
      // Long labels wrap inside their outline on a phone
      className={cn("h-auto whitespace-normal", TONE[tone], className)}
      {...props}
    />
  )
}

/** A few short values, one chosen: Fix / Skip, a storybook control, options. */
export function Segmented({
  value,
  onChange,
  items,
  className,
  itemClassName,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  items: { value: string; label: React.ReactNode; dim?: boolean }[]
  className?: string
  itemClassName?: string
} & Pick<
  React.ComponentProps<typeof ToggleGroup>,
  "aria-label" | "aria-labelledby" | "id"
>) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={onChange}
      className={className}
      {...props}
    >
      {items.map((i) => (
        <ToggleGroupItem
          key={i.value}
          value={i.value}
          className={cn("gap-1.5 px-3", i.dim && "opacity-50", itemClassName)}
        >
          {i.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Folded detail: a caret and a grey label that opens it in place. */
export function Fold({
  title,
  children,
  className,
}: {
  title: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Collapsible className={cn("group/fold", className)}>
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <CaretRightIcon className="size-3.5 transition-transform group-data-[state=open]/fold:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** A list inside a Fold; items may hold inline HTML. */
export function FoldList({ items }: { items: string[] }) {
  return (
    <ul className="m-0 flex max-w-[72ch] flex-col gap-1 pl-4.5 text-sm text-muted-foreground">
      {items.map((x, i) => (
        <Html as="li" key={i} html={x} />
      ))}
    </ul>
  )
}

/**
 * A per-item note: a grey Note button beside the item's pick that opens a
 * field under it. `children` is the pick it sits beside.
 */
export function ItemNote({
  label,
  note,
  setNote,
  children,
  stacked,
}: {
  label: string
  note: string
  setNote: (v: string) => void
  children?: React.ReactNode
  /** The pick is a column of rows: Note goes under it, not beside it */
  stacked?: boolean
}) {
  const [open, setOpen] = React.useState(!!note)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  return (
    <>
      <div
        className={cn(
          "flex gap-2",
          stacked ? "flex-col items-start gap-1" : "items-center"
        )}
      >
        {children}
        <Button
          type="button"
          variant="ghost"
          // Under rows its label lines up with them, not its padding
          className={cn("text-muted-foreground", stacked && "-ml-2.5")}
          onClick={() => {
            flushSync(() => setOpen(!open))
            if (!open) ref.current?.focus()
          }}
        >
          Note
        </Button>
      </div>
      <Textarea
        ref={ref}
        hidden={!open}
        aria-label={label}
        placeholder={label}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-14 max-w-[72ch] resize-y text-sm md:text-sm"
      />
    </>
  )
}

/** Captures two across at most, so each reads without tapping. */
export const PAIR =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-2"

/**
 * Edge fades for a row that scrolls sideways (the tabs on a phone): the side
 * that hides items fades out.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [edges, setEdges] = React.useState({ less: false, more: false })
  const fit = React.useCallback(() => {
    const t = ref.current
    if (!t) return
    setEdges({
      more: t.scrollWidth - t.scrollLeft > t.clientWidth + 1,
      less: t.scrollLeft > 1,
    })
  }, [])
  React.useLayoutEffect(() => {
    fit()
    addEventListener("resize", fit)
    return () => removeEventListener("resize", fit)
  }, [fit])
  const mask =
    edges.less && edges.more
      ? "linear-gradient(90deg,transparent,#000 40px calc(100% - 40px),transparent)"
      : edges.less
        ? "linear-gradient(90deg,transparent,#000 40px)"
        : edges.more
          ? "linear-gradient(90deg,#000 calc(100% - 40px),transparent)"
          : undefined
  return {
    ref,
    onScroll: fit,
    style: { maskImage: mask, WebkitMaskImage: mask },
  }
}
