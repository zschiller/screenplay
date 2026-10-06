// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

import type { MessageAttachment } from "@/lib/agent/message-markers"
import type { AttachmentUpload } from "@/lib/chat-attachments"

const toast = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast }))
vi.mock("@/lib/use-model-catalog", () => ({
  useModelCatalog: () => ({
    status: "ready",
    models: [{ id: "m1", label: "Model", provider: { key: "p", label: "P" } }],
    model: "m1",
    defaultModel: "m1",
    noAgents: false,
    retry: vi.fn(),
  }),
  useSkillIndex: () => ({ skills: [], loading: false }),
}))

import {
  Composer,
  type ComposerAttachmentPort,
  type ComposerSubmitPayload,
} from "./composer"

afterEach(() => {
  cleanup()
  toast.mockClear()
})

const MB = 1024 * 1024

function file(name: string, type: string, size = 4): File {
  const f = new File(["data"], name, { type })
  if (size !== 4) Object.defineProperty(f, "size", { value: size })
  return f
}

/** A port whose uploads resolve when the test says. */
function port() {
  const pending: Array<(result: AttachmentUpload) => void> = []
  const attach = {
    upload: vi.fn(
      (_file: File) =>
        new Promise<AttachmentUpload>((resolve) => pending.push(resolve))
    ),
    remove: vi.fn((_path: string) => {}),
  }
  const finish = async (attachment: MessageAttachment) => {
    await act(async () => pending.shift()!({ ok: true, attachment }))
  }
  return { attach, finish }
}

function renderComposer(attach?: ComposerAttachmentPort, disabled = false) {
  const onSubmit = vi.fn<(payload: ComposerSubmitPayload) => void>()
  const { container } = render(
    <Composer
      markdownLayers={[]}
      onModelChange={vi.fn()}
      onSubmit={onSubmit}
      attach={attach}
      disabled={disabled}
    />
  )
  const composer = container.querySelector<HTMLElement>("[data-slot=composer]")!
  const drop = (...files: File[]) =>
    fireEvent.drop(composer, {
      dataTransfer: { files, types: ["Files"], getData: () => "" },
    })
  return { onSubmit, composer, drop }
}

const send = () => screen.getByRole("button", { name: /^send/i })
const chips = () => screen.queryAllByTestId("composer-attachment")

const photo: MessageAttachment = {
  path: "uploads/shot.png",
  mediaType: "image/png",
  size: 4,
}

describe("Composer attachments (#1525)", () => {
  it("uploads a dropped image, and sends it once it’s attached", async () => {
    const { attach, finish } = port()
    const { drop, onSubmit } = renderComposer(attach)

    drop(file("shot.png", "image/png"))
    expect(attach.upload).toHaveBeenCalledTimes(1)
    expect(chips()).toHaveLength(1)
    expect(chips()[0]!.textContent).toContain("shot.png")
    // Nothing to send until the file has a path.
    expect((send() as HTMLButtonElement).disabled).toBe(true)

    await finish(photo)
    expect((send() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(send())

    const payload = onSubmit.mock.calls[0]![0]
    expect(payload.parts.attachments).toEqual([photo])
    expect(payload.text).toContain('- "uploads/shot.png" (image/png, 4 bytes)')
    expect(chips()).toHaveLength(0)
  })

  it("refuses an unsupported type with a message, uploading nothing", () => {
    const { attach } = port()
    const { drop } = renderComposer(attach)

    drop(file("clip.mov", "video/quicktime"))

    expect(attach.upload).not.toHaveBeenCalled()
    expect(chips()).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith(
      "clip.mov can’t be attached. Agents read images, PDFs, and text and code files."
    )
  })

  it("refuses a file over 25 MB with a message", () => {
    const { attach } = port()
    const { drop } = renderComposer(attach)

    drop(file("huge.pdf", "application/pdf", 30 * MB))

    expect(attach.upload).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      "huge.pdf is 30.0 MB. Files can be up to 25.0 MB."
    )
  })

  it("takes the accepted files of a mixed drop", () => {
    const { attach } = port()
    const { drop } = renderComposer(attach)

    drop(file("notes.md", ""), file("song.mp3", "audio/mpeg"))

    expect(attach.upload).toHaveBeenCalledTimes(1)
    expect(chips()).toHaveLength(1)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it("deletes an uploaded file taken back out before sending", async () => {
    const { attach, finish } = port()
    const { drop } = renderComposer(attach)
    drop(file("shot.png", "image/png"))
    await finish(photo)

    fireEvent.click(screen.getByRole("button", { name: "Remove shot.png" }))

    expect(chips()).toHaveLength(0)
    expect(attach.remove).toHaveBeenCalledWith("uploads/shot.png")
  })

  it("says why an upload failed and drops its chip", async () => {
    let fail!: (result: AttachmentUpload) => void
    const attach = {
      upload: vi.fn(
        () => new Promise<AttachmentUpload>((resolve) => (fail = resolve))
      ),
      remove: vi.fn(),
    }
    const { drop } = renderComposer(attach)
    drop(file("shot.png", "image/png"))

    await act(async () => fail({ ok: false, error: "Files aren’t set up." }))

    await waitFor(() => expect(chips()).toHaveLength(0))
    expect(toast).toHaveBeenCalledWith("Files aren’t set up.")
  })

  it("attaches a pasted file, but lets a paste with text paste its text", () => {
    const { attach } = port()
    renderComposer(attach)
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!

    fireEvent.paste(editor, {
      clipboardData: {
        files: [file("shot.png", "image/png")],
        types: ["Files"],
        getData: () => "",
      },
    })
    expect(attach.upload).toHaveBeenCalledTimes(1)

    fireEvent.paste(editor, {
      clipboardData: {
        files: [file("shot.png", "image/png")],
        types: ["text/plain", "Files"],
        getData: (type: string) => (type === "text/plain" ? "a caption" : ""),
      },
    })
    expect(attach.upload).toHaveBeenCalledTimes(1)
  })

  it("says files go in a chat where the composer takes none", () => {
    const { drop } = renderComposer()
    drop(file("shot.png", "image/png"))
    expect(toast).toHaveBeenCalledWith(
      "Files can be attached in a chat, not here."
    )
    expect(chips()).toHaveLength(0)
  })

  it("attaches files picked with Attach files", () => {
    const { attach } = port()
    const { composer } = renderComposer(attach)
    const input = composer.querySelector<HTMLInputElement>("input[type=file]")!
    const click = vi.spyOn(input, "click")

    fireEvent.click(screen.getByRole("button", { name: "Attach files" }))
    expect(click).toHaveBeenCalledTimes(1)
    fireEvent.change(input, {
      target: { files: [file("shot.png", "image/png"), file("a.ts", "")] },
    })

    expect(attach.upload).toHaveBeenCalledTimes(2)
    expect(chips()).toHaveLength(2)
  })

  it("has no Attach files where the composer takes no files", () => {
    renderComposer()
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull()
  })

  it("says it takes a file dragged over the window, and attaches a drop anywhere", () => {
    // jsdom lays nothing out; the composer is on screen.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList)
    const { attach } = port()
    renderComposer(attach)
    const files = [file("shot.png", "image/png")]
    const dataTransfer = { files, types: ["Files"], getData: () => "" }

    fireEvent.dragOver(window, { dataTransfer })
    expect(screen.getByText("Drop files to attach")).toBeTruthy()
    fireEvent.dragLeave(window, { dataTransfer, relatedTarget: null })
    expect(screen.queryByText("Drop files to attach")).toBeNull()

    fireEvent.dragOver(window, { dataTransfer })
    fireEvent.drop(document.body, { dataTransfer })
    expect(screen.queryByText("Drop files to attach")).toBeNull()
    expect(attach.upload).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it("leaves a dragged text or link alone", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList)
    renderComposer(port().attach)
    fireEvent.dragOver(window, {
      dataTransfer: { files: [], types: ["text/plain"], getData: () => "hi" },
    })
    expect(screen.queryByText("Drop files to attach")).toBeNull()
    vi.restoreAllMocks()
  })

  it("takes no files and no input while disabled", () => {
    const { attach } = port()
    const { drop, composer } = renderComposer(attach, true)
    drop(file("shot.png", "image/png"))
    expect(attach.upload).not.toHaveBeenCalled()
    expect(chips()).toHaveLength(0)
    expect(toast).not.toHaveBeenCalled()
    expect(send().hasAttribute("disabled")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Attach files" }).matches(":disabled")
    ).toBe(true)
    expect(
      composer.querySelector(".tiptap")?.getAttribute("contenteditable")
    ).toBe("false")
  })
})
