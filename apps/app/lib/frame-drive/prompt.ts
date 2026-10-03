import type { ToolNaming } from "@/lib/agent/tool-name"
import type { FrameDriveRuntime } from "@/lib/frame-drive/runtime"

/**
 * How a chat drives frames (#1389, #1390) and Mockups (#1391), for its system
 * prompt. On the Mac both are pages in the asker's own canvas. On hosted a
 * frame is one shared browser (#1396) and a Mockup is driven in the asker's
 * view; a deployment without shared frames drives Mockups only (`frames`
 * null).
 */
export function frameDrivePrompt(
  t: ToolNaming["name"],
  {
    frames,
    viewFrame = true,
  }: {
    frames: FrameDriveRuntime
    /** Whether the chat has `view_frame` to tell apart. */
    viewFrame?: boolean
  }
): string {
  const shared = frames === "shared"
  const tools = `${t("frame_click")}, ${t("frame_type")}, ${t("frame_key")}, ${t("frame_scroll")}, ${t("frame_select")} and ${t("frame_drag")}`
  const intro = shared
    ? `You can drive a frame or Mockup on the canvas, as a person would: ${tools}. A frame is one shared browser: everyone with it on screen watches each step live, and your clicks and keys there are real input, so focus, typing, Tab and hover work. A Mockup you drive in the view of the user who asked; everyone else keeps their own copy.`
    : `You can drive ${
        frames
          ? "a frame or Mockup the user has open on the canvas"
          : "a Mockup the user has open on the canvas (frames can't be driven in the browser yet)"
      }, as they would: ${tools}. You drive it in the view of the user who asked; everyone else keeps their own copy.`
  const check =
    frames && viewFrame
      ? `check each step with ${t("frame_screenshot")}, which shows it as the user sees it (unlike ${t("view_frame")}, which renders a fresh copy of a frame)`
      : `check each step with ${t("frame_screenshot")}, which shows it as the user sees it`
  const open = frames
    ? `\n- Drive a frame of your Workspace that already shows what you need. When none fits, or the one there is something the user is working in, open a new one beside your frames with ${t("frame_open")} rather than taking theirs over.`
    : ""
  const takeOver = shared
    ? "- Anyone can take it from you at any moment: when a step says someone took control, stop, tell them in chat where you got to, and ask before driving again."
    : "- The user can take it from you at any moment: when a step says they took control, stop, tell them in chat where you got to, and ask before driving again."
  const cant = shared
    ? "a file picker anywhere; in a Mockup also the clipboard or typing into a rich-text editor"
    : "a file picker, the clipboard, typing into a rich-text editor"
  const closed = shared
    ? "- A Mockup needs the user's canvas open: when it isn't, say so instead of driving."
    : "- When the canvas isn't open, say so instead of driving."
  return `${intro} Use them when the user asks you to show them something or to get a page into a state.

- Start with ${t("frame_start_driving")}. Their ask is what lets you drive, so they get no second prompt. Pick the pace from what they asked: \`show\` for "show me" (a cursor glides to each target and pauses, and it's brought into their view), \`jump\` for "get it into that state" (straight to the end state, nobody's view moves).${open}
- Read ${t("frame_elements")} first to find targets, and ${check}.
- Each step shows in chat as its own short line, so between steps write at most one short sentence, and only when it helps the user follow along.
- When you're done, call ${t("frame_stop_driving")}.
${takeOver}
- When a step needs something you can't do (${cant}), ask the user to do that step and to tell you when it's done, then end your turn; carry on from there when they reply.
${closed}`
}
