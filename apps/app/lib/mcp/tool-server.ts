import { asSchema, type Tool, type ToolResultPart, type ToolSet } from "ai"

type ToolResultOutput = ToolResultPart["output"]

/**
 * A stateless MCP server over an AI SDK {@link ToolSet}: the JSON-RPC half of
 * the Streamable HTTP transport (MCP 2025-11-25, "basic/transports"). Each POST
 * carries one message; a request gets one JSON response and a notification gets
 * none. No session id and no SSE stream, which the spec allows a server to
 * leave out.
 *
 * Kept free of routing and auth so the tool set, not the transport, decides
 * what an MCP client can do: the Coordinator's MCP route (#903) hands it the
 * same tools the in-process engine runs.
 */

/** MCP tool annotations (hints a client uses to decide whether to prompt). */
export interface McpToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/**
 * Give each tool in `tools` its MCP annotations, which it then carries
 * wherever its toolset goes: a tool builder writes them beside its tools, and
 * the server lists them from the tool itself. Every tool needs an entry.
 */
export function annotateTools<T extends ToolSet>(
  tools: T,
  annotations: { readonly [K in keyof T]: McpToolAnnotations }
): T {
  const annotated: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    annotated[name] = Object.assign({}, tool, {
      annotations: annotations[name],
    })
  }
  return annotated as T
}

/** The annotations {@link annotateTools} gave a tool, if any. */
export function toolAnnotations(tool: Tool): McpToolAnnotations | undefined {
  return (tool as { annotations?: McpToolAnnotations }).annotations
}

export interface McpToolServer {
  name: string
  version: string
  /** The tools it serves, each listed with the annotations it carries. */
  tools: ToolSet
  /** Called when a client completes `initialize`, for logging. */
  onInitialize?(client: { name?: string; version?: string }): void
}

export interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

/** Newest first; the server answers with the client's version when it knows it. */
export const MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

/**
 * Answer one JSON-RPC message. Returns `null` for a notification or a client's
 * response to us, which the transport acknowledges with 202 and no body.
 */
export async function handleMcpMessage(
  server: McpToolServer,
  message: unknown
): Promise<JsonRpcResponse | null> {
  if (!isMessage(message)) {
    return failure(null, INVALID_REQUEST, "Invalid JSON-RPC message")
  }
  // Notifications (`notifications/initialized`, `notifications/cancelled`)
  // and responses carry no id to answer.
  if (message.id === undefined || message.method === undefined) return null
  const id = message.id
  const params = message.params ?? {}

  switch (message.method) {
    case "initialize": {
      const requested = params.protocolVersion
      const protocolVersion = MCP_PROTOCOL_VERSIONS.find((v) => v === requested)
      const clientInfo = params.clientInfo as
        { name?: string; version?: string } | undefined
      server.onInitialize?.(clientInfo ?? {})
      return success(id, {
        protocolVersion: protocolVersion ?? MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
      })
    }
    case "ping":
      return success(id, {})
    case "tools/list":
      return success(id, { tools: await listTools(server) })
    case "tools/call":
      return callTool(server, id, params)
    default:
      return failure(id, METHOD_NOT_FOUND, `Unknown method ${message.method}`)
  }
}

/** A malformed body, answered as the spec's parse error. */
export function parseErrorResponse(): JsonRpcResponse {
  return failure(null, PARSE_ERROR, "Parse error")
}

async function listTools(server: McpToolServer) {
  return Promise.all(
    Object.entries(server.tools).map(async ([name, tool]) => {
      const annotations = toolAnnotations(tool)
      return {
        name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: await asSchema(tool.inputSchema).jsonSchema,
        ...(annotations ? { annotations } : {}),
      }
    })
  )
}

async function callTool(
  server: McpToolServer,
  id: string | number | null,
  params: Record<string, unknown>
): Promise<JsonRpcResponse> {
  const name = params.name
  const tool = typeof name === "string" ? server.tools[name] : undefined
  if (!tool || typeof tool.execute !== "function") {
    return failure(id, INVALID_PARAMS, `Unknown tool ${String(name)}`)
  }

  const schema = asSchema(tool.inputSchema)
  let input: unknown = params.arguments ?? {}
  if (schema.validate) {
    const checked = await schema.validate(input)
    // A bad argument is a tool error the model can read and correct, not a
    // protocol error (MCP "Error Handling").
    if (!checked.success) return toolError(id, checked.error.message)
    input = checked.value
  }

  try {
    const toolCallId = `mcp-${String(id)}`
    const output = await tool.execute(input as never, {
      toolCallId,
      messages: [],
      context: {},
    })
    // A tool that shapes its own model output (a screenshot) keeps that shape
    // over MCP; anything else goes out as text.
    const content = tool.toModelOutput
      ? mcpContent(await tool.toModelOutput({ toolCallId, input, output }))
      : [{ type: "text", text: textOf(output) }]
    return success(id, { content, isError: false })
  } catch (e) {
    return toolError(id, e instanceof Error ? e.message : String(e))
  }
}

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource"
      resource: { uri: string; mimeType: string; blob: string }
    }

/** An AI SDK tool result, as MCP tool-result content. */
function mcpContent(output: ToolResultOutput): McpContent[] {
  switch (output.type) {
    case "text":
    case "error-text":
      return [{ type: "text", text: output.value }]
    case "content":
      return output.value.map((part): McpContent => {
        if (part.type === "text") return { type: "text", text: part.text }
        if (part.type === "image-data") {
          return { type: "image", data: part.data, mimeType: part.mediaType }
        }
        // A document (a PDF a chat opened) goes as an embedded resource.
        if (part.type === "file-data") {
          return {
            type: "resource",
            resource: {
              uri: `file:///${encodeURIComponent(part.filename ?? "file")}`,
              mimeType: part.mediaType,
              blob: part.data,
            },
          }
        }
        return { type: "text", text: JSON.stringify(part) }
      })
    default:
      return [
        {
          type: "text",
          text: textOf("value" in output ? output.value : output),
        },
      ]
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function isMessage(value: unknown): value is JsonRpcMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0"
  )
}

function success(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

function failure(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function toolError(id: string | number | null, text: string): JsonRpcResponse {
  return success(id, { content: [{ type: "text", text }], isError: true })
}
