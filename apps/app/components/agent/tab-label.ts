// A tab's inline-rename field. ALL geometry — the padding and the negative
// margins that cancel it — is reserved in BOTH modes (transparent in view) so
// the box is identical whether or not we're editing. Entering edit mode then
// only toggles paint (bg/shadow/ring), never layout, so the tab can't shift or
// resize. The negative margins cancel the padding so the popped box doesn't
// widen the tab's footprint.
export const TAB_LABEL_CLASS =
  "max-w-[120px] min-w-0 rounded-xs px-0.5 py-0.5 -mx-0.5 -my-0.5"
// Edit-mode-only decoration. Uses theme tokens (not the sidebar rows' hardcoded
// white) so it reads against the tab strip.
export const TAB_LABEL_EDIT_CLASS =
  "relative z-10 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-background text-foreground shadow-sm ring-[0.5px] ring-border"
