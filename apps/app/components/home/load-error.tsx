"use client"

import { useState } from "react"
import {
  ArrowClockwiseIcon,
  WarningCircleIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"
import { SettingsRow, SettingsRowList } from "@/components/home/settings-row"

/**
 * Retry, with the regular spinner in place of its icon while the retry runs. A
 * retry that fails again leaves the error on screen and re-enables the button;
 * the caller's `onRetry` rejecting is that signal, so it is swallowed here.
 */
export function RetryButton({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [retrying, setRetrying] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true)
        try {
          await onRetry()
        } catch (err) {
          console.error("Retry failed", err)
        } finally {
          setRetrying(false)
        }
      }}
    >
      {retrying ? <Spinner className="size-4" /> : <ArrowClockwiseIcon />}
      Retry
    </Button>
  )
}

/**
 * A page-sized load failure: the error counterpart of an empty state, so a list
 * that failed to load never reads as a list with nothing in it.
 */
export function LoadErrorState({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => Promise<unknown>
}) {
  return (
    <Empty className="h-full" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon className="text-destructive" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <RetryButton onRetry={onRetry} />
      </EmptyContent>
    </Empty>
  )
}

/**
 * A settings-row load failure, a {@link SettingsRow} like the rows it stands in
 * for (GitHub, coding agents, presets) so the section keeps its layout while it
 * waits for a retry.
 */
export function LoadErrorRow({
  title,
  detail = "Something went wrong. Try again.",
  onRetry,
}: {
  title: string
  detail?: string
  onRetry: () => Promise<unknown>
}) {
  return (
    <SettingsRowList>
      <SettingsRow
        role="alert"
        icon={WarningCircleIcon}
        iconClassName="text-destructive"
        title={title}
        detail={detail}
        action={<RetryButton onRetry={onRetry} />}
      />
    </SettingsRowList>
  )
}
