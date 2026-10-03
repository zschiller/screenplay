import { describe, expect, it } from "vitest"

import { buildFileTools } from "@/lib/agent/file-tools"
import { imageModelOutput } from "@/lib/agent/image-output"
import { createFiles, memoryFileIndex, type Files } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"

/** One canvas's files, the way two chats on it share them. */
function canvas(): Files {
  return createFiles({
    index: memoryFileIndex(),
    store: memoryFileStore(),
    keyPrefix: "canvas/room-1",
  })
}

type Tools = ReturnType<typeof buildFileTools>

async function run(tools: Tools, name: keyof Tools, input: object) {
  const execute = tools[name].execute as (
    input: object,
    options: object
  ) => Promise<unknown>
  return execute(input, { toolCallId: "t1", messages: [], context: {} })
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
const PDF = new TextEncoder().encode("%PDF-1.7")

describe("saved-file tools", () => {
  it("a file one chat saves, another chat on the canvas lists and reads", async () => {
    const files = canvas()
    const writer = buildFileTools({ canvas: files, chatId: "chat-a" })
    const reader = buildFileTools({ canvas: files, chatId: "chat-b" })

    expect(
      await run(writer, "save_file", {
        path: "research/pricing.md",
        content: "# Pricing\nTiers: 3",
      })
    ).toBe("Saved research/pricing.md (18 B, text/markdown).")

    expect(await run(reader, "list_saved_files", {})).toBe(
      ["- research/", "- research/pricing.md (18 B, text/markdown)"].join("\n")
    )
    expect(
      await run(reader, "read_saved_file", { path: "research/pricing.md" })
    ).toBe("# Pricing\nTiers: 3")
  })

  it("records the saving chat as the author", async () => {
    const files = canvas()
    await run(
      buildFileTools({ canvas: files, chatId: "chat-a" }),
      "save_file",
      {
        path: "a.md",
        content: "x",
      }
    )
    const listed = await files.list()
    expect(listed.ok && listed.value[0]).toMatchObject({
      addedBy: "agent",
      addedById: "chat-a",
    })
  })

  it("makes folders, moves and renames files, and deletes folders with their contents", async () => {
    const tools = buildFileTools({ canvas: canvas(), chatId: "chat-a" })
    expect(await run(tools, "make_saved_folder", { path: "refs" })).toBe(
      "Made the folder."
    )
    await run(tools, "save_file", { path: "notes.md", content: "n" })
    expect(
      await run(tools, "move_saved_file", { path: "notes.md", to: "refs/n.md" })
    ).toBe("Moved to refs/n.md.")
    expect(
      await run(tools, "move_saved_file", { path: "refs", to: "archive" })
    ).toBe("Moved the folder to archive with 1 item in it.")
    expect(await run(tools, "delete_saved_file", { path: "archive" })).toBe(
      "Deleted the folder and 1 item in it."
    )
    expect(await run(tools, "list_saved_files", {})).toBe("No saved files yet.")
  })

  it("answers a bad path or a missing file with an error the model can read", async () => {
    const tools = buildFileTools({ canvas: canvas(), chatId: "chat-a" })
    expect(await run(tools, "read_saved_file", { path: "nope.md" })).toMatch(
      /^Error: No file at "nope.md"/
    )
    expect(
      await run(tools, "save_file", { path: "../escape.md", content: "x" })
    ).toMatch(/^Error: /)
    expect(await run(tools, "save_file", { path: "a.md" })).toBe(
      "Error: pass the file's `content`."
    )
  })

  it("saves a binary file from the sandbox, and hands an image back as a part", async () => {
    const tools = buildFileTools({
      canvas: canvas(),
      chatId: "chat-a",
      readSource: async (path) => (path === "out/shot.png" ? PNG : null),
    })
    expect(
      await run(tools, "save_file", {
        path: "refs/shot.png",
        source_path: "out/shot.png",
      })
    ).toBe("Saved refs/shot.png (4 B, image/png).")
    expect(
      await run(tools, "save_file", { path: "x.png", source_path: "missing" })
    ).toBe("Error: no file at missing.")

    const output = await run(tools, "read_saved_file", {
      path: "refs/shot.png",
    })
    expect(imageModelOutput({ output })).toEqual({
      type: "content",
      value: [
        { type: "text", text: "refs/shot.png (4 B, image/png)" },
        {
          type: "image-data",
          data: Buffer.from(PNG).toString("base64"),
          mediaType: "image/png",
        },
      ],
    })
  })

  it("hands a PDF back as a file part", async () => {
    const tools = buildFileTools({
      canvas: canvas(),
      chatId: "chat-a",
      readSource: async () => PDF,
    })
    await run(tools, "save_file", { path: "brief.pdf", source_path: "b.pdf" })

    const output = await run(tools, "read_saved_file", { path: "brief.pdf" })
    expect(imageModelOutput({ output })).toEqual({
      type: "content",
      value: [
        { type: "text", text: "brief.pdf (8 B, PDF)" },
        {
          type: "file-data",
          data: Buffer.from(PDF).toString("base64"),
          mediaType: "application/pdf",
          filename: "brief.pdf",
        },
      ],
    })
  })

  it("offers `source_path` only to a chat with a sandbox", async () => {
    const schemaOf = async (tools: Tools) =>
      JSON.stringify(await tools.save_file.inputSchema)
    expect(
      await schemaOf(buildFileTools({ canvas: canvas(), chatId: "c" }))
    ).not.toContain("source_path")
    expect(
      await schemaOf(
        buildFileTools({
          canvas: canvas(),
          chatId: "c",
          readSource: async () => null,
        })
      )
    ).toContain("source_path")
  })
})
