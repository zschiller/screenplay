"use client"

import { useSyncExternalStore } from "react"
import type { HarnessModelChoice } from "@/lib/agent/harnesses/types"
import type { HarnessModelChoices } from "@/lib/harness-model-menu"

// The models people chose in Settings › Agent for a Harness whose CLI reaches
// too many to curate (OpenCode, #1589), by Harness key. Stored per device in
// localStorage, like the default model (`lib/default-model-store.ts`), because
// what's installed and signed in differs from device to device. The menu they
// make is `lib/harness-model-menu.ts`.
const STORAGE_KEY = "agent-harness-models"

export type { HarnessModelChoices }

const EMPTY: HarnessModelChoices = {}
const listeners = new Set<() => void>()
// useSyncExternalStore needs the same object back until something changes.
let cache: { raw: string | null; value: HarnessModelChoices } | null = null

export function readHarnessModelChoices(): HarnessModelChoices {
  if (typeof window === "undefined") return EMPTY
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {}
  if (cache && cache.raw === raw) return cache.value
  cache = { raw, value: parse(raw) }
  return cache.value
}

function parse(raw: string | null): HarnessModelChoices {
  if (!raw) return EMPTY
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return EMPTY
    }
    const out: HarnessModelChoices = {}
    for (const [key, list] of Object.entries(value)) {
      if (!Array.isArray(list)) continue
      out[key] = list.filter(
        (m): m is HarnessModelChoice =>
          typeof m?.id === "string" &&
          typeof m?.label === "string" &&
          typeof m?.group === "string"
      )
    }
    return out
  } catch {
    return EMPTY
  }
}

/** Replace the models chosen for Harness `key`, in the order given. */
export function writeHarnessModelChoices(
  key: string,
  models: HarnessModelChoice[]
) {
  if (typeof window === "undefined") return
  const next = { ...readHarnessModelChoices(), [key]: models }
  if (models.length === 0) delete next[key]
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Another window of the app changing the choice.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/** The chosen models, live across Settings and every model menu. */
export function useHarnessModelChoices(): HarnessModelChoices {
  return useSyncExternalStore(subscribe, readHarnessModelChoices, () => EMPTY)
}
