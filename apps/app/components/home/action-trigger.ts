/**
 * Classes for a home tile's or row's ⋯ actions trigger, which sits in a `group`
 * (the tile or the table row). Matches the in-room sidebar's row actions: shown
 * on hover, on keyboard focus anywhere in the tile, and while its menu is open;
 * always shown below `md`, where there is no hover to reveal it.
 */
export const ACTION_TRIGGER_REVEAL =
  "transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 md:opacity-0"
