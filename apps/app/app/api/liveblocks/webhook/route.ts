import { yjsHost } from "@/lib/yjs-host"

// The rebuild reads the room's Y.Doc (a Liveblocks REST round-trip) and may
// write a manifest; give it headroom over the default function budget.
export const maxDuration = 60

/**
 * Provider webhook entry point. Kept deliberately thin: the active Yjs host owns
 * the provider-specific verification and handling (`handleDocChangeWebhook`),
 * so this route just delegates. A host with no webhook source (the local
 * in-process host) doesn't implement it, and we 404.
 */
export async function POST(req: Request): Promise<Response> {
  if (!yjsHost.handleDocChangeWebhook) {
    return new Response("Webhooks not supported by the active Yjs host", {
      status: 404,
    })
  }
  return yjsHost.handleDocChangeWebhook(req)
}
