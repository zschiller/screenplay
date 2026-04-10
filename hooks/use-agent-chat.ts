"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { AgentMessage, AgentStreamEvent } from "@/lib/agent/types"

interface UseAgentChatOptions {
  sandboxName: string
  sessionId?: string
  onSessionId?: (sessionId: string) => void
}

async function fetchHistory(sessionId: string): Promise<AgentMessage[]> {
  const res = await fetch(
    `/api/agent/history?sessionId=${encodeURIComponent(sessionId)}`,
  )
  if (!res.ok) return []
  return res.json()
}

export function useAgentChat({
  sandboxName,
  sessionId: initialSessionId,
  onSessionId,
}: UseAgentChatOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null)
  const abortRef = useRef<AbortController | null>(null)
  const historyLoadedRef = useRef(false)
  const isStreamingRef = useRef(false)

  // Load history on mount
  useEffect(() => {
    if (historyLoadedRef.current || !initialSessionId) return
    historyLoadedRef.current = true
    sessionIdRef.current = initialSessionId

    setIsLoadingHistory(true)
    fetchHistory(initialSessionId)
      .then((history) => {
        if (history.length > 0) setMessages(history)
      })
      .catch(() => {})
      .finally(() => setIsLoadingHistory(false))
  }, [initialSessionId])

  // Poll for updates from other clients every 3s when not streaming
  useEffect(() => {
    const sid = initialSessionId
    if (!sid) return

    const interval = setInterval(() => {
      if (isStreamingRef.current) return
      fetchHistory(sid).then((history) => {
        if (history.length > 0) setMessages(history)
      }).catch(() => {})
    }, 3000)

    return () => clearInterval(interval)
  }, [initialSessionId])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      setError(null)
      setMessages((prev) => [...prev, { role: "user", content: text }])
      setIsStreaming(true)
      isStreamingRef.current = true

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
                onSessionId?.(event.sessionId)
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
        isStreamingRef.current = false
        abortRef.current = null
      }
    },
    [sandboxName, isStreaming, onSessionId],
  )

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
    isStreamingRef.current = false
  }, [])

  const resetConversation = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setIsStreaming(false)
    isStreamingRef.current = false
    setError(null)
    sessionIdRef.current = null
    onSessionId?.("")
  }, [onSessionId])

  return {
    messages,
    isStreaming,
    isLoadingHistory,
    error,
    sendMessage,
    stopGeneration,
    resetConversation,
  }
}
