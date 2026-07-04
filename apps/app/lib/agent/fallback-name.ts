/**
 * Deterministic fallback naming for a Workspace's git branch and chat label,
 * used when no model is available (or a model call fails) to name them.
 *
 * The output is a tightened slug — a short readable prefix drawn from the
 * prompt's meaningful words (stop-words dropped), a length cap, and a short
 * deterministic id for uniqueness — so a prompt like
 * "please fix the flaky login test" yields the branch `fix-flaky-login-test-<id>`
 * and the label "Fix Flaky Login Test" instead of the raw truncated-prompt slug
 * (`please-fix-the-flaky-login-tes`) and first-six-words label that shipped
 * before.
 *
 * Pure and deterministic: the same prompt always produces the same name, which
 * keeps it unit-testable and free of `Math.random`. Callers still run the
 * result through the existing name-sanitization, length bounds, and remote
 * de-duplication.
 */

/** Function words dropped before building the slug — they carry no signal. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "be",
  "been",
  "this",
  "that",
  "it",
  "its",
  "i",
  "my",
  "me",
  "we",
  "our",
  "you",
  "your",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "do",
  "does",
  "did",
  "so",
  "if",
  "then",
  "than",
  "just",
  "up",
  "down",
  "out",
  "into",
  "about",
  "please",
  "let",
  "lets",
])

/** How many meaningful words survive into the branch/label. */
const MAX_KEYWORDS = 4
/** Character cap on the readable keyword segment of the branch. */
const MAX_KEYWORD_CHARS = 30
/** Length of the deterministic disambiguating id. */
const ID_LENGTH = 4
/** Character cap on the chat label. */
const MAX_LABEL_CHARS = 50
/** Prefix used when a prompt has no meaningful words left after stop-words. */
const FALLBACK_PREFIX = "task"
/** Label used when a prompt has no meaningful words left after stop-words. */
const DEFAULT_LABEL = "Untitled Task"

/** Lowercase the prompt, split on non-alphanumerics, drop stop-words. */
function extractKeywords(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
    .slice(0, MAX_KEYWORDS)
}

/**
 * A short, stable base36 id derived from the whole prompt via FNV-1a, so two
 * prompts that slugify to the same keywords still get distinct branches.
 */
function shortId(seed: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(ID_LENGTH, "0").slice(-ID_LENGTH)
}

/** Trim the hyphenated keyword slug to the cap without splitting a word. */
function capSlug(slug: string): string {
  if (slug.length <= MAX_KEYWORD_CHARS) return slug
  return slug
    .slice(0, MAX_KEYWORD_CHARS)
    .replace(/-[^-]*$/, "")
    .replace(/-+$/, "")
}

/**
 * Derive a deterministic fallback `{ branch, label }` from a prompt: a
 * stop-words-dropped keyword prefix, a length cap, and a short unique id.
 */
export function deriveFallbackName(prompt: string): {
  branch: string
  label: string
} {
  const trimmed = prompt.trim()
  const keywords = extractKeywords(trimmed)
  const id = shortId(trimmed)

  const slug = capSlug(keywords.join("-"))
  const branch = slug ? `${slug}-${id}` : `${FALLBACK_PREFIX}-${id}`

  let label: string
  if (keywords.length === 0) {
    label = DEFAULT_LABEL
  } else {
    const title = keywords
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
    label =
      title.length > MAX_LABEL_CHARS
        ? `${title.slice(0, MAX_LABEL_CHARS).trimEnd()}…`
        : title
  }

  return { branch, label }
}
