import "server-only"

import { tool, jsonSchema } from "ai"
import { annotateTools } from "@/lib/mcp/tool-server"
import {
  ASK_QUESTION_TOOL,
  MAX_QUESTION_OPTIONS,
  MIN_QUESTION_OPTIONS,
  parseQuestion,
} from "@/lib/agent/question"

/**
 * Question Cards (#1312), available to every chat. The call itself is the
 * question: the chat draws its arguments as a card, and the user's click comes
 * back as their next message, so the tool only checks the arguments and tells
 * the model to stop and wait.
 */
export function buildQuestionTools() {
  const tools = {
    [ASK_QUESTION_TOOL]: tool({
      description: [
        `Ask the user a question they answer with one click. Use it for a real fork only the user can decide, with ${MIN_QUESTION_OPTIONS} to ${MAX_QUESTION_OPTIONS} short options; mark the one you'd pick as recommended.`,
        "The chat shows it as a card, and the option they click arrives as their next message, word for word. After calling this, end your turn: don't answer it yourself or keep working on the fork.",
      ].join(" "),
      inputSchema: jsonSchema<{
        question: string
        options: Array<{ label: string; detail?: string }>
        recommended?: number
      }>({
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, in one short sentence.",
          },
          options: {
            type: "array",
            minItems: MIN_QUESTION_OPTIONS,
            maxItems: MAX_QUESTION_OPTIONS,
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description: "The option, in one to four words.",
                },
                detail: {
                  type: "string",
                  description: "Optional: one line on what picking it means.",
                },
              },
              required: ["label"],
            },
          },
          recommended: {
            type: "integer",
            description:
              "Optional: the index (from 0) of the option you recommend.",
          },
        },
        required: ["question", "options"],
      }),
      execute: async (input) => {
        if (!parseQuestion(input)) {
          return `Not asked: a question needs a question and ${MIN_QUESTION_OPTIONS} to ${MAX_QUESTION_OPTIONS} options, each with a label.`
        }
        return "Asked. End your turn now; the user's choice arrives as their next message."
      },
    }),
  }
  // For a harness reaching it over MCP: showing a card changes nothing.
  return annotateTools(tools, {
    [ASK_QUESTION_TOOL]: { readOnlyHint: true, openWorldHint: false },
  })
}
