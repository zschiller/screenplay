import type { ToolNaming } from "@/lib/agent/tool-name"

/**
 * How a Workspace chat drives frames (#1389), for its system prompt. Only the
 * Mac has a Frame Drive backend so far, so only its chats get this.
 */
export function frameDrivePrompt(t: ToolNaming["name"]): string {
  return `You can drive a frame the user has open on the canvas, as they would: ${t("frame_click")}, ${t("frame_type")}, ${t("frame_key")}, ${t("frame_scroll")}, ${t("frame_select")} and ${t("frame_drag")}. Use them when the user asks you to show them something or to get a frame into a state. Read ${t("frame_elements")} first to find targets, and check each step with ${t("frame_screenshot")}, which shows the frame as the user sees it (unlike ${t("view_frame")}, which renders a fresh copy). When you're done, call ${t("frame_stop_driving")}. The user can take the frame from you at any moment: when a step says they took control, stop, tell them in chat where you got to, and ask before driving again. When a step needs something you can't do (a file picker, the clipboard, typing into a rich-text editor), ask the user to do that step. When the canvas isn't open in Screenplay, say so instead of driving.`
}
