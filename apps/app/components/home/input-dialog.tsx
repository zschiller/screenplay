"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFailed(false)
    try {
      await onSubmit(value)
      onCancel()
    } catch (err) {
      console.error(err)
      setFailed(true)
    } finally {
      setSubmitting(false)
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
        />
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
