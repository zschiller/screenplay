// Strips GitHub tokens and inline basic-auth credentials from text that could
// end up in the chat UI, Liveblocks broadcasts, or the Anthropic session
// history. The sandbox has the user's GitHub token baked into origin's URL, so
// any failing git command can spill it via stderr.
//
// It also strips the Workspace's own env var values (#1416) when the caller
// hands them in: a chat can `printenv` inside the sandbox, and only the
// Repo's adder is meant to see the values. Best-effort only: an agent can
// still encode a value some other way.

const TOKEN_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
]

// Matches basic-auth credentials embedded in a URL: https://user:pass@host
const URL_AUTH_PATTERN = /(https?:\/\/)[^\s:/@]+:[^\s@]+@/g

const REDACTED = "[REDACTED]"

/** Values shorter than this aren't redacted, so `true` or `3000` don't vanish
 *  from every reply. */
export const MIN_SECRET_LENGTH = 8

/**
 * The strings to strip for a set of env var values: each value of at least
 * {@link MIN_SECRET_LENGTH} characters, plus its base64 (standard and
 * URL-safe, padding dropped) and URL-encoded forms. Longest first, so a value
 * that contains another is replaced whole.
 */
export function secretPatterns(values: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const value of values) {
    if (value.length < MIN_SECRET_LENGTH) continue
    out.add(value)
    const b64 = base64(value).replace(/=+$/, "")
    out.add(b64)
    out.add(b64.replace(/\+/g, "-").replace(/\//g, "_"))
    out.add(encodeURIComponent(value))
  }
  return [...out].sort((a, b) => b.length - a.length)
}

function base64(value: string): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function replaceSecrets(input: string, secrets: readonly string[]): string {
  let output = input
  for (const secret of secrets) {
    if (output.includes(secret)) output = output.split(secret).join(REDACTED)
  }
  return output
}

/**
 * Redact `input`. `secrets` are literal strings to strip (the output of
 * {@link secretPatterns}), on top of the GitHub token and URL-auth patterns.
 */
export function redactSensitiveInfo(
  input: string,
  secrets: readonly string[] = []
): string {
  let output = replaceSecrets(input, secrets)
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, REDACTED)
  }
  output = output.replace(URL_AUTH_PATTERN, `$1${REDACTED}@`)
  return output
}

/** {@link redactSensitiveInfo} over every string inside a JSON-shaped value
 *  (a tool's structured output, an ACP update). Other values pass through. */
export function redactDeep<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === "string") {
    return redactSensitiveInfo(value, secrets) as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, secrets)) as T
  }
  if (value && typeof value === "object" && isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, secrets)
    return out as T
  }
  return value
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Redacts `secrets` from text that arrives in chunks, where a value can be
 * split across two of them. Each {@link push} returns what's safe to show
 * now and holds back the last (longest secret − 1) characters, never cutting
 * through a whole match; {@link flush} returns the rest at the end of the
 * block. With no secrets nothing is held back.
 */
export interface StreamRedactor {
  push(chunk: string): string
  flush(): string
}

export function createStreamRedactor(
  secrets: readonly string[]
): StreamRedactor {
  const holdBack = secrets.reduce((n, s) => Math.max(n, s.length - 1), 0)
  let tail = ""
  return {
    push(chunk) {
      if (holdBack === 0) return chunk
      const text = tail + chunk
      let cut = Math.max(0, text.length - holdBack)
      // A whole match straddling the cut stays in the tail with its start.
      for (const secret of secrets) {
        let at = text.indexOf(secret)
        while (at !== -1 && at < cut) {
          if (at + secret.length > cut) cut = at
          at = text.indexOf(secret, at + secret.length)
        }
      }
      tail = text.slice(cut)
      return replaceSecrets(text.slice(0, cut), secrets)
    },
    flush() {
      const rest = replaceSecrets(tail, secrets)
      tail = ""
      return rest
    },
  }
}
