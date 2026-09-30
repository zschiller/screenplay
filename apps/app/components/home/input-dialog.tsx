"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

type InputDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  initialValue?: string
  submitLabel: string
  submittingLabel: string
  placeholder?: string
  /**
   * Shown inline under the field when `onSubmit` rejects — the same pattern
   * as the Move dialog. A fixed line rather than the error's own message,
   * which a server action redacts in production.
   */
  errorMessage: string
  onSubmit: (value: string) => Promise<void>
}

/**
 * A one-field dialog (Rename, New folder). It follows ConfirmDialog while the
 * submit is in flight: the dialog can't be dismissed, both buttons are
 * disabled, and the submit shows the regular spinner. Submit stays disabled
 * while the field is empty or still holds `initialValue`, so it never sends a
 * no-op.
 */
export function InputDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue = "",
  submitLabel,
  submittingLabel,
  placeholder,
  errorMessage,
  onSubmit,
}: InputDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        // No ×, like Escape and Cancel, while the submit is in flight.
        showCloseButton={!submitting}
      >
        {open && (
          <InputDialogForm
            title={title}
            description={description}
            initialValue={initialValue}
            submitLabel={submitLabel}
            submittingLabel={submittingLabel}
            placeholder={placeholder}
            errorMessage={errorMessage}
            onSubmit={onSubmit}
            submitting={submitting}
            onSubmittingChange={setSubmitting}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InputDialogForm({
  title,
  description,
  initialValue,
  submitLabel,
  submittingLabel,
  placeholder,
  errorMessage,
  onSubmit,
  submitting,
  onSubmittingChange,
  onCancel,
}: {
  title: string
  description?: string
  initialValue: string
  submitLabel: string
  submittingLabel: string
  placeholder?: string
  errorMessage: string
  onSubmit: (value: string) => Promise<void>
  submitting: boolean
  onSubmittingChange: (submitting: boolean) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [failed, setFailed] = useState(false)
  const trimmed = value.trim()
  const canSubmit =
    !submitting && trimmed !== "" && trimmed !== initialValue.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Enter submits the form even while the button is disabled.
    if (!canSubmit) return
    onSubmittingChange(true)
    setFailed(false)
    try {
      await onSubmit(value)
      onSubmittingChange(false)
      onCancel()
    } catch (err) {
      console.error(err)
      setFailed(true)
      onSubmittingChange(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="my-4 space-y-2">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          // Read-only, not disabled, so the field keeps its look and focus.
          readOnly={submitting}
        />
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? (
            <>
              {/* The regular Spinner, as ConfirmDialog: plain progress. */}
              <Spinner aria-hidden role={undefined} aria-label={undefined} />
              {submittingLabel}
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}
