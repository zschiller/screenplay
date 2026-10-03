import type { ReactNode } from "react"
import { WarningIcon } from "@workspace/ui/components/icons"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"

/**
 * Shared pieces of the delete confirms that say what you lose (issue #776):
 * Delete workspace and Remove project.
 */

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
