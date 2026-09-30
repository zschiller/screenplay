/**
 * Plain wording for errors the chat shows. A transport
 * or engine error arrives as whatever the failing layer threw ("HTTP 500", a
 * URL that timed out after 120000ms, a provider's JSON), which says nothing a
 * person can act on. The chat shows one plain sentence instead and keeps the
 * original behind Copy error.
 */

/** Why an agent's turn stopped, in one sentence. */
export function describeTurnError(raw: string): string {
  const timeout = raw.match(/timed out after (\d+)\s*ms/i)
  if (timeout) {
    return `The agent stopped responding after ${formatDuration(Number(timeout[1]))}.`
  }
  if (/\btime[sd]? ?out\b|ETIMEDOUT/i.test(raw)) {
    return "The agent stopped responding."
  }
  if (/\b(429|529)\b|rate.?limit|overloaded|too many requests/i.test(raw)) {
    return "The model is busy right now."
  }
  if (isUnreachable(raw)) return "The agent couldn't be reached."
  return "The agent stopped because of an error."
}

/**
 * Why a message wasn't sent. The server's own sentences (a session that has
 * ended) pass through; transport errors become one plain line.
 */
export function describeSendError(raw: string): string {
  if (isUnreachable(raw)) return "The agent couldn't be reached."
  const text = raw.trim()
  if (isSentence(text)) return /[.!?]$/.test(text) ? text : `${text}.`
  return "Something went wrong."
}

/**
 * A 502 to 504, a refused connection, or a fetch that never got an answer: the other
 * end didn't respond, as opposed to answering with a reason.
 */
function isUnreachable(raw: string): boolean {
  return /\b50[234]\b|fetch failed|failed to fetch|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network ?error|load failed/i.test(
    raw
  )
}

/**
 * Text a person wrote for a person: one line of words starting with a capital,
 * with no status code, URL, error class or JSON in it.
 */
function isSentence(text: string): boolean {
  return (
    /^[A-Z][a-z']* [^\n]+$/.test(text) &&
    !/\bHTTP \d{3}\b|https?:\/\/|^\w*Error:|[{}]/.test(text)
  )
}

/** 120000 → "2 minutes"; under a minute reads in seconds. */
function formatDuration(ms: number): string {
  if (ms >= 60_000) {
    const minutes = Math.round(ms / 60_000)
    return minutes === 1 ? "a minute" : `${minutes} minutes`
  }
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds === 1 ? "a second" : `${seconds} seconds`
}
