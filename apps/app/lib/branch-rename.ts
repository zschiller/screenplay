/**
 * Lowercase and hyphenate a typed name (or a model's suggestion) into a
 * git-safe branch name. The one ref sanitizer (#910).
 */
export function sanitizeBranchName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
