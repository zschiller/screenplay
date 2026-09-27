"use client"

import { MotionConfig } from "motion/react"

/**
 * Honour the OS reduce-motion setting in every `motion` animation: with it on,
 * transform and layout animations (the springs) jump to their end state and
 * only opacity still fades. The CSS side — keyframes and transitions — is the
 * `prefers-reduced-motion` block in `app/globals.css`.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
