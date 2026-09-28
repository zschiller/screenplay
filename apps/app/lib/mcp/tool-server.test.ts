import { describe, expect, it } from "vitest"
import { jsonSchema, tool } from "ai"

import { imageModelOutput } from "@/lib/agent/image-output"
import { handleMcpMessage, type McpToolServer } from "./tool-server"

const screenshot = {
  kind: "image" as const,
  caption: "Live preview of frame [f1]",
  data: "iVBORw0KGgo=",
  mediaType: "image/png",
}

const server: McpToolServer = {
  name: "test",
  version: "1",
  tools: {
    view: tool({
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
      }),
      execute: async ({ id }) => (id === "f1" ? screenshot : "not found"),
      toModelOutput: imageModelOutput,
    }),
    count: tool({
      inputSchema: jsonSchema<Record<string, never>>({ type: "object" }),
      execute: async () => ({ frames: 3 }),
    }),
  },
}

async function call(name: string, args: unknown) {
  const response = await handleMcpMessage(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  })
  return (response!.result as { content: unknown[] }).content
}

describe("MCP tools/call content", () => {
  it("sends a screenshot as caption text plus an MCP image", async () => {
    expect(await call("view", { id: "f1" })).toEqual([
      { type: "text", text: screenshot.caption },
      { type: "image", data: screenshot.data, mimeType: "image/png" },
    ])
  })

  it("sends a shaped tool's plain answer as text", async () => {
    expect(await call("view", { id: "nope" })).toEqual([
      { type: "text", text: "not found" },
    ])
  })

  it("sends any other result as JSON text", async () => {
    expect(await call("count", {})).toEqual([
      { type: "text", text: '{"frames":3}' },
    ])
  })
})
