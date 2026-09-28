"use client"

import { useId } from "react"
import { Check, Minus } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Where a setup step stands. `current` is the one expanded step; the rest are
 * one-row summaries: `done` (a green tick), `skipped` (a grey dash, never the
 * tick), or `upcoming` (its number, muted).
 */
export type SetupStepState = "current" | "upcoming" | "done" | "skipped"

/** A small muted chip beside a step or agent name ("Optional", "Recommended"). */
export function SetupChip({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      {children}
    </Badge>
  )
}

/**
 * The expanded, current step: a dark 1px border so it reads as active, a
 * numbered title, and its body indented under the title.
 */
export function CurrentSetupStep({
  step,
  title,
  chip,
  children,
}: {
  step: number
  title: string
  chip?: React.ReactNode
  children: React.ReactNode
}) {
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-foreground p-4 dark:border-foreground/60"
    >
      <div className="flex items-center gap-2.5">
        <StepMarker step={step} state="current" />
        <h2 id={titleId} className="text-sm font-semibold">
          {title}
        </h2>
        {chip}
      </div>
      <div className="flex min-w-0 flex-col gap-3 pl-[30px]">{children}</div>
    </section>
  )
}

/**
 * A step that isn't current, collapsed to one row: its marker, its title, and
 * (once settled) the choice made, with Change to reopen it.
 */
export function CollapsedSetupStep({
  step,
  state,
  title,
  summary,
  chip,
  onChange,
}: {
  step: number
  state: Exclude<SetupStepState, "current">
  title: string
  summary?: string
  chip?: React.ReactNode
  onChange?: () => void
}) {
  return (
    <div className="flex h-10 items-center gap-2.5 rounded-lg border px-4 text-sm">
      {/* The same 20px slot as the current step's marker, so titles line up
          down the page. */}
      <span className="flex size-5 shrink-0 items-center justify-center">
        <StepMarker step={step} state={state} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(state === "upcoming" && "text-muted-foreground")}>
          {title}
        </span>
        {summary && <span className="text-muted-foreground"> · {summary}</span>}
      </span>
      {chip}
      {onChange && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2.5"
          onClick={onChange}
        >
          Change
        </Button>
      )}
    </div>
  )
}

/**
 * A step's marker: its number while current or upcoming, a green tick once
 * done, a grey dash once skipped, so a skipped step never reads as finished.
 */
export function StepMarker({
  step,
  state,
}: {
  step: number
  state: SetupStepState
}) {
  const label = {
    current: `Step ${step}:`,
    upcoming: `Step ${step}:`,
    done: `Step ${step}, done:`,
    skipped: `Step ${step}, skipped:`,
  }[state]
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums",
        state === "current"
          ? "size-5 border-[1.5px] border-foreground text-[11px]"
          : "size-4 text-[10px]",
        state === "upcoming" && "border border-border text-muted-foreground",
        state === "done" && "bg-emerald-600 text-white dark:bg-emerald-500",
        state === "skipped" && "bg-muted text-muted-foreground"
      )}
    >
      {state === "done" ? (
        <Check className="size-2.5" strokeWidth={3.5} aria-hidden />
      ) : state === "skipped" ? (
        <Minus className="size-2.5" strokeWidth={3.5} aria-hidden />
      ) : (
        <span aria-hidden>{step}</span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  )
}
