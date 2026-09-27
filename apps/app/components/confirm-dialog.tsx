"use client"

import { useRef, useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { lastInputWasPointer } from "@/lib/input-modality"

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The action, as one capitalized verb ("Delete", "Remove", "Leave",
   * "Recreate"). It starts the title and is the confirm button's label, so
   * the question and the answer always use the same word.
   */
  verb: string
  /** The item's own name, quoted in the title: Delete “Quarterly plan”? */
  itemName?: string
  /**
   * What kind of thing the item is ("canvas", "comment"). Used in the title
   * when there's no name to quote (Delete comment?) and in the fallback error.
   */
  itemNoun: string
  description: ReactNode
  /**
   * Optional slot between the description and the footer, for an option such
   * as "Also delete on remote". A function receives whether the confirm is in
   * flight, so the option can disable itself meanwhile.
   */
  children?: ReactNode | ((state: { pending: boolean }) => ReactNode)
  /** Red confirm for permanent destruction; leaving a shared canvas is not. */
  destructive?: boolean
  /** Defaults to the verb's -ing form ("Deleting…"). */
  pendingLabel?: string
  /**
   * Runs the action. The dialog stays open and shows `pendingLabel` until it
   * settles; a throw is shown inline under the description and the dialog
   * stays open to retry. On success the caller closes the dialog.
   */
  onConfirm: () => Promise<void> | void
}

/** "Delete" → "Deleting…", "Leave" → "Leaving…", "Remove" → "Removing…". */
export function pendingLabelFor(verb: string): string {
  const stem = verb.endsWith("e") ? verb.slice(0, -1) : verb
  return `${stem}ing…`
}

export function confirmTitle(
  verb: string,
  itemName: string | undefined,
  itemNoun: string
): string {
  const name = itemName?.trim()
  return name ? `${verb} “${name}”?` : `${verb} ${itemNoun}?`
}

/**
 * The one confirm every destructive action goes through: a title that quotes
 * the item, a description, an optional option slot, and an async confirm with
 * built-in pending state and inline error. While the confirm is in flight the
 * dialog can't be dismissed and both buttons are disabled.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  verb,
  itemName,
  itemNoun,
  description,
  children,
  destructive = true,
  pendingLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True while Cancel holds focus that a mouse open put there: its ring stays
  // hidden until the first key press, so only keyboard users see it.
  const [quietFocus, setQuietFocus] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Reset transient state when the dialog closes, so reopening starts clean.
  // Done during render via the previous-prop pattern rather than in an effect
  // (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setPending(false)
      setError(null)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        // Focus goes to the safe action, Cancel. Opened by mouse, its ring
        // stays hidden until a key is pressed; opened by keyboard, it shows.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          setQuietFocus(lastInputWasPointer())
          cancelRef.current?.focus()
        }}
        onKeyDown={() => {
          if (quietFocus) setQuietFocus(false)
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            {confirmTitle(verb, itemName, itemNoun)}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {typeof children === "function" ? children({ pending }) : children}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancelRef}
            disabled={pending}
            className={cn(
              quietFocus &&
                "focus-visible:border-transparent focus-visible:ring-0"
            )}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={async (event) => {
              // Keep the dialog open until the action settles.
              event.preventDefault()
              setPending(true)
              setError(null)
              try {
                await onConfirm()
              } catch (err) {
                setError(
                  err instanceof Error && err.message
                    ? err.message
                    : `Couldn’t ${verb.toLowerCase()} ${itemNoun}`
                )
                setPending(false)
              }
            }}
          >
            {pending ? (
              <>
                {/* The regular Spinner: this is plain progress, not agent
                    activity. Hidden from the accessible name, which is the
                    pending label alone. */}
                <Spinner aria-hidden role={undefined} aria-label={undefined} />
                {pendingLabel ?? pendingLabelFor(verb)}
              </>
            ) : (
              verb
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * An opt-in extra for a confirm's option slot ("Also delete the branch on
 * origin"): a checkbox with its label and an optional hint underneath.
 */
export function ConfirmOption({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
        className="mt-0.5"
      />
      {/* Left-aligned text in the body's own size and weight: the option is
          part of the sentence above it, not a heading over its hint. */}
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="leading-5 font-normal">
          {label}
        </Label>
        {hint && (
          <div className="text-[13px] leading-5 text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
    </div>
  )
}
