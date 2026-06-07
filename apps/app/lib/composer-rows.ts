/**
 * Composer-row helpers — the pure state model behind the New Workspace dialog's
 * opt-in parallel mode (#327).
 *
 * Parallel creation lives inside the one prompt-first dialog (ADR 0004) as a
 * stack of {@link ComposerRow}s, each a full Composer carrying its own
 * independent `{ baseBranch, model, prompt, planMode }`. A "+ Add another"
 * action clones the previous row's base and model with an empty prompt, so
 * fanning out variations off the same base is one click. Submitting runs every
 * row through the branch-creation planner — one plan, one Branch per row —
 * preserving heterogeneous prompts, bases, and models end to end.
 *
 * These helpers are pure: row identity (the stable React `key`) is minted by an
 * injected `makeKey` factory so the model stays free of any global counter or
 * randomness and is trivially testable.
 */

import type { ComposerSpec } from "./branch-create-planner"

/**
 * One row in the dialog: a {@link ComposerSpec} plus a stable `key`. The key
 * survives add/remove so React keeps each row's mounted Composer (and its live
 * draft) attached to the right row even as siblings come and go.
 */
export interface ComposerRow extends ComposerSpec {
  key: string
}

/** A fresh row off `baseBranch` with `model` selected and an empty prompt. */
function freshRow(
  baseBranch: string,
  model: string,
  makeKey: () => string
): ComposerRow {
  return { key: makeKey(), baseBranch, model, prompt: "", planMode: false }
}

/** The single row the dialog opens on: the chosen base, default model, no prompt. */
export function initialRows(
  baseBranch: string,
  model: string,
  makeKey: () => string
): ComposerRow[] {
  return [freshRow(baseBranch, model, makeKey)]
}

/**
 * Append a row that clones the previous row's `baseBranch` and `model` with an
 * empty prompt and plan-mode off (#327) — the quick path to fanning out
 * variations off the same base. With no previous row to clone (only possible
 * before any row exists) it falls back to empty base/model.
 */
export function appendClonedRow(
  rows: ComposerRow[],
  makeKey: () => string
): ComposerRow[] {
  const prev = rows[rows.length - 1]
  return [...rows, freshRow(prev?.baseBranch ?? "", prev?.model ?? "", makeKey)]
}

/** Remove the row at `index`, never dropping below a single row. */
export function removeRow(rows: ComposerRow[], index: number): ComposerRow[] {
  if (rows.length <= 1) return rows
  return rows.filter((_, i) => i !== index)
}

/**
 * Where focus lands after removing the row at `removed` from a list that now
 * has `length` rows. Focus shifts to the previous row when a row at or before
 * the focused one is removed, and is otherwise clamped into range.
 */
export function focusAfterRemove(
  focused: number,
  removed: number,
  length: number
): number {
  const next = removed <= focused ? focused - 1 : focused
  return Math.max(0, Math.min(next, length - 1))
}

/** How many characters of the prompt a collapsed row's summary shows. */
export const PROMPT_PREVIEW_MAX = 72

/**
 * The one-line summary a collapsed (non-focused) row shows: `base · model ·
 * prompt preview`, keeping a stack of rows scannable. An empty prompt — a bare
 * scratch Branch — reads as "bare branch" in the prompt slot.
 */
export function summarizeRow(row: ComposerSpec, modelLabel: string): string {
  const prompt = row.prompt.trim()
  const preview =
    prompt.length > PROMPT_PREVIEW_MAX
      ? prompt.slice(0, PROMPT_PREVIEW_MAX).trimEnd() + "…"
      : prompt
  return [row.baseBranch, modelLabel, preview || "bare branch"].join(" · ")
}
