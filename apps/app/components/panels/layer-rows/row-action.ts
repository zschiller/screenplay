/*
 * A layer row's ⋯ menu, built like the Chats menu's and the Canvas settings
 * Files tree's: the row never makes room for it. It shows on the row's own
 * hover, on keyboard focus and while its menu is open, covering the end of
 * the row on the hover fill and fading in from the left. The row keeps that
 * fill while the pointer is on the ⋯ or its menu is open. Touch screens
 * always show it, so there the row keeps room for it.
 *
 * Two copies because Tailwind needs each group name spelled out: frame and
 * document rows are `group/frame-row`, a Group's header `group/frame-group-row`.
 */

export const frameRowButtonClass =
  "!pr-7 md:!pr-2 md:group-hover/frame-row:bg-sidebar-accent md:group-hover/frame-row:text-sidebar-accent-foreground group-has-[[data-sidebar=menu-action][aria-expanded=true]]/frame-row:bg-sidebar-accent group-has-[[data-sidebar=menu-action][aria-expanded=true]]/frame-row:text-sidebar-accent-foreground"

export const frameRowActionClass =
  "group-hover/frame-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 md:bg-sidebar-accent md:opacity-0 md:before:pointer-events-none md:before:absolute md:before:inset-y-0 md:before:-left-4 md:before:w-4 md:before:bg-gradient-to-r md:before:from-transparent md:before:to-sidebar-accent"

export const frameGroupRowButtonClass =
  "!pr-7 md:!pr-2 md:group-hover/frame-group-row:bg-sidebar-accent md:group-hover/frame-group-row:text-sidebar-accent-foreground group-has-[[data-sidebar=menu-action][aria-expanded=true]]/frame-group-row:bg-sidebar-accent group-has-[[data-sidebar=menu-action][aria-expanded=true]]/frame-group-row:text-sidebar-accent-foreground"

export const frameGroupRowActionClass =
  "group-hover/frame-group-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 md:bg-sidebar-accent md:opacity-0 md:before:pointer-events-none md:before:absolute md:before:inset-y-0 md:before:-left-4 md:before:w-4 md:before:bg-gradient-to-r md:before:from-transparent md:before:to-sidebar-accent"
