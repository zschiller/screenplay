"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import {
  listHarnessSetupRows,
  noteHarnessConnected,
  resolveHarnessSetupRun,
} from "@/lib/agent/harnesses/setup-actions"
import type {
  HarnessSetupRow,
  HarnessSetupRun,
} from "@/lib/agent/harnesses/setup"
import {
  setupRunError,
  setupStartError,
} from "@/lib/agent/harnesses/setup-error"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"
import { LoadErrorRow } from "@/components/home/load-error"
import { CollapsedSetupStep, CurrentSetupStep, SetupChip } from "./setup-step"

/**
 * Step 1 of the setup gate: a coding agent. One agent is preselected (a signed-in
 * one if there is one, else the recommended one) and the others appear only
 * after Change, so the step is one choice rather than a card per agent. The
 * chosen agent's install or sign-in runs in the inline host terminal, as in the
 * Settings panel; the gate's own poll decides when the step is done.
 */
export function AgentStep({
  current,
  done,
  onChange,
  onCollapse,
}: {
  current: boolean
  /** The gate's release fact for this step. */
  done: boolean
  /** Reopen the step from its collapsed row. */
  onChange: () => void
  /** Close a step reopened with Change. */
  onCollapse: () => void
}) {
  const [rows, setRows] = useState<HarnessSetupRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [run, setRun] = useState<HarnessSetupRun | null>(null)
  const [preparing, setPreparing] = useState(false)
  // Why the last Install or Sign in didn't work, shown under its button.
  const [error, setError] = useState<string | null>(null)

  // Read the rows on mount, and again when the gate's poll sees the step change
  // (a sign-in finished in a terminal outside the app), so the collapsed row
  // names the agent that's actually signed in.
  useEffect(() => {
    let cancelled = false
    listHarnessSetupRows()
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((err) => {
        console.error("Failed to check coding agents", err)
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [done])

  // Retry after a failed check; a second failure rejects and leaves the error up.
  const recheck = useCallback(async () => {
    setRows(await listHarnessSetupRows())
    setLoadFailed(false)
  }, [])

  const recommended = rows?.find((r) => r.recommended) ?? rows?.[0] ?? null
  const selected =
    rows?.find((r) => r.key === selectedKey) ??
    rows?.find((r) => r.connected) ??
    recommended
  const signedIn = selected?.connected
    ? selected
    : (rows?.find((r) => r.connected) ?? null)

  if (!current) {
    return (
      <CollapsedSetupStep
        step={1}
        state={done ? "done" : "upcoming"}
        title={done ? "Coding agent" : "Install a coding agent"}
        summary={done && signedIn ? `${signedIn.label}, signed in` : undefined}
        onChange={done ? onChange : undefined}
      />
    )
  }

  const start = async (row: HarnessSetupRow) => {
    if (!row.action) return
    const kind = row.action.kind
    setPreparing(true)
    setError(null)
    try {
      const plan = await resolveHarnessSetupRun(row.key, kind)
      if (plan) setRun(plan)
      else setError(setupStartError(kind))
    } catch (err) {
      console.error("Failed to start coding agent setup", err)
      setError(setupStartError(kind))
    } finally {
      setPreparing(false)
    }
  }

  // The run finished: bust the availability memo and read fresh rows, then
  // say so if the agent still isn't signed in.
  const finishRun = async () => {
    setRun(null)
    const kind = selected?.action?.kind
    let next: HarnessSetupRow[] | undefined
    try {
      next = await noteHarnessConnected()
      setRows(next)
    } catch (err) {
      console.error("Failed to re-check coding agents", err)
    }
    if (kind && selected) {
      setError(
        setupRunError(
          kind,
          selected.label,
          next?.find((r) => r.key === selected.key)
        )
      )
    }
  }

  return (
    <CurrentSetupStep step={1} title="Install a coding agent">
      <p className="text-sm text-muted-foreground">
        Agent chats and terminals run on a coding CLI on this device.
      </p>
      {loadFailed ? (
        <LoadErrorRow title="Couldn’t check coding agents" onRetry={recheck} />
      ) : !rows || !selected ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Checking coding agents…
        </div>
      ) : run ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{run.message}</p>
          <HostSessionTerminal
            sessionKey={`screenplay-harness-setup-${selected.hostBinary}`}
            command={run.command}
            onExit={finishRun}
          />
        </div>
      ) : (
        <>
          {choosing ? (
            <AgentChoices
              rows={rows}
              selectedKey={selected.key}
              recommendedKey={recommended?.key}
              onPick={(key) => {
                setSelectedKey(key)
                setChoosing(false)
                setError(null)
              }}
            />
          ) : (
            <div className="flex min-h-7 items-center gap-2 text-sm">
              <span className="font-medium">{selected.label}</span>
              {selected.key === recommended?.key && (
                <SetupChip>Recommended</SetupChip>
              )}
              {/* Right-aligned, like the status column in the agent list. */}
              <span className="ml-auto text-xs text-muted-foreground">
                {agentState(selected)}
              </span>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mr-2.5"
                  onClick={() => setChoosing(true)}
                >
                  Change
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {selected.connected ? (
              <Button type="button" onClick={onCollapse}>
                Use {selected.label}
              </Button>
            ) : (
              selected.action && (
                <Button
                  type="button"
                  disabled={preparing}
                  onClick={() => start(selected)}
                >
                  {preparing && <Spinner className="size-4" />}
                  {actionLabel(selected)}
                </Button>
              )
            )}
            {done && !selected.connected && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelectedKey(null)
                  onCollapse()
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          {error && !selected.connected && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </CurrentSetupStep>
  )
}

/**
 * Every agent, one row each, to pick the one to set up. A row reads its state
 * in plain words; picking one closes the list.
 */
function AgentChoices({
  rows,
  selectedKey,
  recommendedKey,
  onPick,
}: {
  rows: HarnessSetupRow[]
  selectedKey: string
  recommendedKey: string | undefined
  onPick: (key: string) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Coding agent"
      className="flex flex-col divide-y overflow-hidden rounded-lg border"
    >
      {rows.map((row) => {
        const checked = row.key === selectedKey
        return (
          <button
            key={row.key}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onPick(row.key)}
            className="flex items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                checked && "border-foreground"
              )}
              aria-hidden
            >
              {checked && (
                <span className="size-1.5 rounded-full bg-foreground" />
              )}
            </span>
            <span className="min-w-0 truncate">{row.label}</span>
            {row.key === recommendedKey && <SetupChip>Recommended</SetupChip>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {agentState(row)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** An agent's state in a few words, never repeating its name. */
function agentState(row: HarnessSetupRow): string {
  if (row.connected) return "Signed in"
  if (row.installed) return "Signed out"
  return "Not installed"
}

/** The button says exactly what it does, naming the agent. */
function actionLabel(row: HarnessSetupRow): string {
  return row.action?.kind === "install"
    ? `Install ${row.label} and sign in`
    : `Sign in to ${row.label}`
}
