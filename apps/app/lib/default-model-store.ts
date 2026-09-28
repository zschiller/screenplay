"use client"

import { useSyncExternalStore } from "react"

// The user's default agent and model: the one model id new chats and new
// Workspaces start from, set in Settings. Stored per device in localStorage,
// like the other agent prefs (`lib/canvas/tab-kind.ts`), because what's
// installed differs from device to device.
//
// Before the Settings control existed the composer wrote the last-picked model
// to `agent-last-model` and every new chat followed it. That value seeds the
// default until the user sets one, so nobody's starting model changes under
// them on upgrade; nothing writes the old key any more.
const DEFAULT_MODEL_STORAGE_KEY = "agent-default-model"
const LEGACY_LAST_MODEL_STORAGE_KEY = "agent-last-model"

const listeners = new Set<() => void>()

export function readDefaultModel(): string | null {
  if (typeof window === "undefined") return null
  try {
    return (
      window.localStorage.getItem(DEFAULT_MODEL_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_LAST_MODEL_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

export function writeDefaultModel(modelId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(DEFAULT_MODEL_STORAGE_KEY, modelId)
  } catch {}
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Another window of the app changing the default.
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEFAULT_MODEL_STORAGE_KEY) onChange()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/** The stored default model id, live across Settings and open chats. */
export function useDefaultModel(): string | null {
  return useSyncExternalStore(subscribe, readDefaultModel, () => null)
}
