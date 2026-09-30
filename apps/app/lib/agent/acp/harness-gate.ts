/**
 * A plan-gated Coordinator tool (#898, #901) called by a desktop harness over
 * MCP: the plan the card shows and what approving it acts on, as the tool's
 * gate rendered them.
 */
export interface HarnessGateCall {
  /** The tool's own name, e.g. `create_workspaces`. */
  toolName: string
  plan: string
  input: { gate: string } & Record<string, unknown>
}

/**
 * Pauses a chat's running harness turn on a plan or confirm card. Resolves
 * false when the turn can't pause (it has already stopped, or another card is
 * already up).
 */
export type HarnessGateHandler = (call: HarnessGateCall) => Promise<boolean>

/**
 * The live harness turns that can pause on a card, by chat. The MCP route
 * that receives the tool call and the turn it belongs to run in the same
 * sidecar process but not the same request, so they meet here. Kept on
 * `globalThis` so every route bundle sees the same map, as the MCP tokens are
 * (`coordinator-mcp.ts`).
 */
const handlers: Map<string, HarnessGateHandler> = ((
  globalThis as { __harnessGates?: Map<string, HarnessGateHandler> }
).__harnessGates ??= new Map())

/**
 * Let `chatId`'s running turn pause on a card. Returns the unregister, which
 * leaves a newer turn's handler in place.
 */
export function registerHarnessGate(
  chatId: string,
  handler: HarnessGateHandler
): () => void {
  handlers.set(chatId, handler)
  return () => {
    if (handlers.get(chatId) === handler) handlers.delete(chatId)
  }
}

/**
 * Pause `chatId`'s running harness turn on the card `call` describes. False
 * when no turn of that chat is running, or it can't pause.
 */
export async function raiseHarnessGate(
  chatId: string,
  call: HarnessGateCall
): Promise<boolean> {
  const handler = handlers.get(chatId)
  return handler ? handler(call) : false
}
