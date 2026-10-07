/**
 * Does this input look like a clone URL (any host), rather than a repo-name
 * search term? Pure and client-side: the unified add-repo picker calls it on
 * every keystroke to decide whether to surface the "Add <url>" row, so it stays
 * deliberately conservative — a bare `owner/repo` or a one-word search must not
 * read as a URL (acceptance: no false "Add URL" row). Resolution itself (and
 * any non-GitHub no-auth-floor handling) still happens in `resolveRepoFromUrl`.
 */
export function looksLikeCloneUrl(input: string): boolean {
  const s = input.trim()
  // URLs carry no whitespace; a multi-word search never resolves to one.
  if (!s || /\s/.test(s)) return false
  // scheme://…  — https, http, ssh, git, file
  if (/^(?:https?|ssh|git|file):\/\/.+/i.test(s)) return true
  // scp-like: user@host:path  (e.g. git@github.com:owner/repo.git)
  if (/^[^@\s]+@[^:\s]+:.+/.test(s)) return true
  // bare host/path that names a git repo explicitly
  if (/\.git$/i.test(s) && s.includes("/")) return true
  return false
}
