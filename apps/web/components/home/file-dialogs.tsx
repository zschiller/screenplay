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
  onSubmit,
  onCancel,
}: {
  title: string
  description?: string
  initialValue: string
  submitLabel: string
  submittingLabel: string
  placeholder?: string
  onSubmit: (value: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit(value)
      onCancel()
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
      <div className="my-4">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
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
