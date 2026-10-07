"use client"

import { createContext, useContext } from "react"
import { ArrowRightIcon } from "@workspace/ui/components/icons"
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { PageData } from "@/lib/types"

/** What a Move to page moves: a Layer (alone) or a whole Group. */
export type MoveToPageTarget = { kind: "layer" | "group"; id: string }

/**
 * The canvas's pages and its move, for every Layer and Group menu's Move to
 * page ▸ (#1837). Outside a canvas there's none, and the menus leave it out.
 */
export type MoveToPage = {
  pages: readonly PageData[]
  currentPageId: string
  move: (target: MoveToPageTarget, pageId: string) => void
}

export const MoveToPageContext = createContext<MoveToPage | null>(null)

/** Move to page ▸, listing every page but the current one; nothing on a
 *  canvas with one page. */
export function MoveToPageSubMenu({ target }: { target: MoveToPageTarget }) {
  const ctx = useContext(MoveToPageContext)
  const others = ctx?.pages.filter((p) => p.id !== ctx.currentPageId) ?? []
  if (!ctx || others.length === 0) return null
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ArrowRightIcon />
        Move to page
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {others.map((page) => (
          <DropdownMenuItem
            key={page.id}
            onSelect={() => ctx.move(target, page.id)}
          >
            {page.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
