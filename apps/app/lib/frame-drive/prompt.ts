import type { ToolNaming } from "@/lib/agent/tool-name"

/**
 * How a chat drives frames (#1389) and Mockups (#1391), for its system
 * prompt. The Mac drives both; hosted drives Mockups only, so far (`frames`).
 */
export function frameDrivePrompt(
  t: ToolNaming["name"],
  {
    frames,
    viewFrame = true,
  }: {
    frames: boolean
    /** Whether the chat has `view_frame` to tell apart. */
    viewFrame?: boolean
  }
): string {
  const what = frames
    ? "a frame or Mockup the user has open on the canvas"
    : "a Mockup the user has open on the canvas (frames can't be driven in the browser yet)"
  const check =
    frames && viewFrame
      ? `check each step with ${t("frame_screenshot")}, which shows it as the user sees it (unlike ${t("view_frame")}, which renders a fresh copy of a frame)`
      : `check each step with ${t("frame_screenshot")}, which shows it as the user sees it`
  return `You can drive ${what}, as they would: ${t("frame_click")}, ${t("frame_type")}, ${t("frame_key")}, ${t("frame_scroll")}, ${t("frame_select")} and ${t("frame_drag")}. You drive it in the view of the user who asked; everyone else keeps their own copy. Use them when the user asks you to show them something or to get a page into a state. Read ${t("frame_elements")} first to find targets, and ${check}. When you're done, call ${t("frame_stop_driving")}. The user can take it from you at any moment: when a step says they took control, stop, tell them in chat where you got to, and ask before driving again. When a step needs something you can't do (a file picker, the clipboard, typing into a rich-text editor), ask the user to do that step. When the canvas isn't open, say so instead of driving.`
}
