/**
 * The in-process engine against real models: a multi-step tool turn with a
 * Steer joining mid-pass, then the turn's usage. The `.sdk.test.ts` suite pins
 * the same AI SDK semantics over a mock model; this one proves each configured
 * provider still behaves. Skipped unless ENGINE_LIVE=1; a provider without its
 * key is skipped too.
 *
 *   ENGINE_LIVE=1 pnpm vitest run lib/agent/acp/in-process-engine.live.test.ts
 *
 * ENGINE_LIVE_MODELS overrides the model list (comma-separated model ids).
 */
import { describe, expect, it } from "vitest"
import {
  jsonSchema,
  streamText,
  tool,
  wrapLanguageModel,
  type LanguageModel,
} from "ai"

import { resolveLanguageModel } from "@/lib/agent/providers"
import { InProcessEngine } from "./in-process-engine"
import { textBlock } from "./schema"

const RUN = process.env.ENGINE_LIVE === "1"

const MODELS: Array<{ id: string; key: string }> = process.env
  .ENGINE_LIVE_MODELS
  ? process.env.ENGINE_LIVE_MODELS.split(",").map((id) => ({ id, key: "" }))
  : [
      { id: "anthropic:claude-sonnet-5-5", key: "ANTHROPIC_API_KEY" },
      { id: "openai:gpt-5.5", key: "OPENAI_API_KEY" },
      { id: "google:gemini-3.8-flash", key: "GOOGLE_GENERATIVE_AI_API_KEY" },
    ]

const STEER = "Also: end your final reply with the word PINEAPPLE."

function recorded(model: LanguageModel) {
  const prompts: unknown[] = []
  const wrapped = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        prompts.push(params.prompt)
        return params
      },
    } as Parameters<typeof wrapLanguageModel>[0]["middleware"],
  })
  return { wrapped, prompts }
}

/** How many times `needle` shows up across a prompt's user text parts. */
function userMentions(prompt: unknown, needle: string): number {
  let n = 0
  for (const m of prompt as Array<{ role: string; content: unknown }>) {
    if (m.role !== "user" || typeof m.content === "string") continue
    for (const p of m.content as Array<{ type: string; text?: string }>) {
      if (p.type === "text" && p.text?.includes(needle)) n++
    }
  }
  return n
}

describe.runIf(RUN)("InProcessEngine against live models", () => {
  for (const { id, key } of MODELS) {
    it.skipIf(key !== "" && !process.env[key])(
      `${id}: a mid-pass Steer lands once, and usage adds up`,
      { timeout: 180_000 },
      async () => {
        const { wrapped, prompts } = recorded(resolveLanguageModel(id))
        let calls = 0
        const echo = tool({
          description: "Echo a counter back. Call it when asked to.",
          inputSchema: jsonSchema<Record<string, never>>({ type: "object" }),
          execute: async () => `echo ${++calls}`,
        })
        let takes = 0
        const engine = new InProcessEngine((config) =>
          streamText({ ...config, model: wrapped })
        )
        const updates: string[] = []
        const errors: string[] = []
        let text = ""
        await engine.run(
          {
            chatId: "c",
            runId: "r",
            roomId: "rm",
            systemPrompt: "You are a terse test agent.",
            model: id,
            history: [
              {
                role: "user",
                content: [
                  textBlock(
                    "Call the echo tool, wait for its result, then call it a second time, then reply with one short sentence."
                  ),
                ],
              },
            ],
            tools: { echo },
            // The first take is before step 0; the second, before step 1.
            takeSteers: async () =>
              ++takes === 2 ? [{ id: "s", content: [textBlock(STEER)] }] : [],
          },
          (u) => {
            updates.push(u.kind)
            if (u.kind === "error") errors.push(u.message)
            if (
              u.kind === "session_update" &&
              u.update.sessionUpdate === "agent_message_chunk" &&
              u.update.content.type === "text"
            ) {
              text += u.update.content.text
            }
          },
          new AbortController().signal
        )

        expect(errors).toEqual([])
        expect(updates.at(-1)).toBe("done")
        expect(calls).toBeGreaterThanOrEqual(2)
        // The Steer joined after step 0 and rides every later step, once.
        expect(userMentions(prompts[0], "PINEAPPLE")).toBe(0)
        for (const p of prompts.slice(1)) {
          expect(userMentions(p, "PINEAPPLE")).toBe(1)
        }
        expect(text).toMatch(/pineapple/i)

        const usage = engine.lastTurnUsage()
        console.log(id, { steps: prompts.length, usage, text })
        expect(usage?.inputTokens).toBeGreaterThan(0)
        expect(usage?.outputTokens).toBeGreaterThan(0)
      }
    )
  }
})
