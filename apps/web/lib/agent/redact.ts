// Strips GitHub tokens and inline basic-auth credentials from text that could
// end up in the chat UI, Liveblocks broadcasts, or the Anthropic session
// history. The sandbox has the user's GitHub token baked into origin's URL, so
// any failing git command can spill it via stderr.

const TOKEN_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
]

// Matches basic-auth credentials embedded in a URL: https://user:pass@host
const URL_AUTH_PATTERN = /(https?:\/\/)[^\s:/@]+:[^\s@]+@/g

export function redactSensitiveInfo(input: string): string {
  let output = input
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]")
  }
  output = output.replace(URL_AUTH_PATTERN, "$1[REDACTED]@")
  return output
}
