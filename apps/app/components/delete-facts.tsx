import type { ReactNode } from "react"
import { WarningIcon } from "@workspace/ui/components/icons"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"

/**
 * Shared pieces of the delete confirms that say what you lose (issue #776):
 * Delete workspace and Remove project.
 */

/** "3 chats, 2 frames and its sandbox". A comma before the last item when an
 *  item already has its own "and" ("…on this computer and GitHub, and PR #4"). */
export function joinFacts(facts: string[]): string {
  if (facts.length <= 1) return facts[0] ?? ""
  const last = facts[facts.length - 1]!
  const head = facts.slice(0, -1).join(", ")
  const serial = facts.some((f) => f.includes(" and "))
  return `${head}${serial ? "," : ""} and ${last}`
}

/**
 * The amber warning a delete shows only when it would destroy work git hasn't
 * saved elsewhere. Stock shadcn Alert (outline, regular text) with the icon in
 * the warning ink.
 */
export function LostWorkAlert({ children }: { children: ReactNode }) {
  return (
    <Alert className="[&>svg]:text-warning">
      <WarningIcon />
      <AlertDescription className="text-current">{children}</AlertDescription>
    </Alert>
  )
}
