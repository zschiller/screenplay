"use client"

import { useCallback, useRef, useState } from "react"
import type { AgentMessage, AgentStreamEvent } from "@/lib/agent/types"

interface UseAgentChatOptions {
  sandboxName: string
}

export function useAgentChat({ sandboxName }: UseAgentChatOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      setError(null)
      setMessages((prev) => [...prev, { role: "user", content: text }])
      setIsStreaming(true)

      const abort = new AbortController()
      abortRef.current = abort

      try {
        const res = await fetch("/api/agent/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxName,
            message: text,
            sessionId: sessionIdRef.current,
          }),
          signal: abort.signal,
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(errorText || `HTTP ${res.status}`)
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error("No response body")

        const decoder = new TextDecoder()
        let buffer = ""
        let assistantText = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const json = line.slice(6)
            if (!json) continue

            let event: AgentStreamEvent
            try {
              event = JSON.parse(json)
            } catch {
              continue
            }

            switch (event.type) {
              case "session_id":
                sessionIdRef.current = event.sessionId
                break

              case "text":
                assistantText += event.text
                setMessages((prev) => {
                  const last = prev[prev.length - 1]
                  if (last?.role === "assistant") {
                    return [
                      ...prev.slice(0, -1),
                      { role: "assistant", content: assistantText },
                    ]
                  }
                  return [
                    ...prev,
                    { role: "assistant", content: assistantText },
                  ]
                })
                break

              case "tool_use":
                // Reset assistant text accumulator for next text block
                assistantText = ""
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "tool_use",
                    name: event.name as AgentMessage & { role: "tool_use" } extends { name: infer N } ? N : never,
                    input: event.input,
                  },
                ])
                break

              case "tool_result":
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "tool_result",
                    name: event.name as AgentMessage & { role: "tool_result" } extends { name: infer N } ? N : never,
                    output: event.output,
                  },
                ])
                break

              case "error":
                setError(event.message)
                setMessages((prev) => [
                  ...prev,
                  { role: "error", content: event.message },
                ])
                break

              case "done":
                break
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          const msg = e instanceof Error ? e.message : String(e)
          setError(msg)
          setMessages((prev) => [...prev, { role: "error", content: msg }])
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [sandboxName, isStreaming],
  )

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const resetConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setIsStreaming(false)
    setError(null)
    sessionIdRef.current = null
  }, [])

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    stopGeneration,
    resetConversation,
  }
}
