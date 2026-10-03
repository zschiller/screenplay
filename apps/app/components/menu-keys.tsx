"use client"

import { DropdownMenuShortcut } from "@workspace/ui/components/dropdown-menu"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"

/** A menu item's key hint: one `Kbd` per key, right-aligned. */
export function MenuKeys({ keys }: { keys: readonly string[] }) {
  return (
    <DropdownMenuShortcut className="tracking-normal">
      <KbdGroup>
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
    </DropdownMenuShortcut>
  )
}
