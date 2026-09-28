"use client"

import { useCallback, useSyncExternalStore } from "react"

type Clock = {
  now: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
}

/** One shared clock per interval, so every timestamp ticks together. */
const clocks = new Map<number, Clock>()

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs)
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: null }
    clocks.set(intervalMs, clock)
  }
  return clock
}

function subscribeClock(intervalMs: number, onChange: () => void) {
  const clock = clockFor(intervalMs)
  clock.listeners.add(onChange)
  if (!clock.timer) {
    // An idle clock is stale; catch it up as it starts ticking again.
    clock.now = Date.now()
    clock.timer = setInterval(() => {
      clock.now = Date.now()
      for (const l of clock.listeners) l()
    }, intervalMs)
    onChange()
  }
  return () => {
    clock.listeners.delete(onChange)
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer)
      clock.timer = null
    }
  }
}

function readClock(intervalMs: number): number {
  return clockFor(intervalMs).now
}

/**
 * The current time, re-read every `intervalMs` so relative timestamps ("4m")
 * keep counting while they're on screen.
 */
export function useNow(intervalMs = 30_000): number {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeClock(intervalMs, onChange),
    [intervalMs]
  )
  const read = useCallback(() => readClock(intervalMs), [intervalMs])
  return useSyncExternalStore(subscribe, read, read)
}
