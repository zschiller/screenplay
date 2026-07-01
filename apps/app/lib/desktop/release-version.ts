/**
 * The pure, tested core of the desktop macOS release flow (PRD #629): resolve
 * the next release version and rewrite it into the three files that carry it —
 * `package.json`, `tauri.conf.json`, and `Cargo.toml` — without touching git,
 * the filesystem, or tauri.
 *
 * Version bumping and the "does this tag already exist" guard are the most
 * bug-prone part of a release script, so they live here as a dependency-free
 * module: the set of existing tags is *injected* rather than read from git,
 * and the file rewrites take contents in and hand contents back. That keeps
 * the whole resolution lifecycle unit-testable without running a build.
 *
 * Mirrors the "pure protocol, dependencies injected/absent" shape of
 * `apps/app/lib/github-local/device-flow.ts`.
 */

/** Prefix of the git tag a desktop release is cut against (`desktop-v0.1.0`). */
export const DESKTOP_TAG_PREFIX = "desktop-v"

/** The bump keywords, distinct from an explicit-semver bump. */
export type BumpKeyword = "patch" | "minor" | "major" | "none"

/**
 * How to move from the current version: a keyword, or an explicit semver
 * string (e.g. `"0.2.0"`) to pin the next version outright.
 */
export type VersionBump = BumpKeyword | (string & {})

/** Why a resolution was refused, for the caller to report. */
export type ResolveVersionReason =
  | "invalid-current"
  | "invalid-bump"
  | "tag-exists"

/** A resolved version plus the tag it would be cut against, or a rejection. */
export type ResolveVersionResult =
  | { ok: true; version: string; tag: string }
  | { ok: false; reason: ResolveVersionReason; message: string }

interface Semver {
  major: number
  minor: number
  patch: number
}

/** Core `MAJOR.MINOR.PATCH` — the shape these three files actually carry. */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/

function parseSemver(value: string): Semver | null {
  const match = SEMVER_RE.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

/** The git tag a given version is released under. */
export function desktopTagFor(version: string): string {
  return `${DESKTOP_TAG_PREFIX}${version}`
}

/**
 * Resolve the next version from `current` and a `bump` keyword or explicit
 * semver, refusing any resolution whose `desktop-v<version>` tag already
 * exists in the injected `existingTags` (so a release is never cut over a tag
 * that's already been published). `none` passes the current version through
 * unchanged — still subject to the tag guard.
 */
export function resolveVersion(
  current: string,
  bump: VersionBump,
  existingTags: Iterable<string> = []
): ResolveVersionResult {
  const parsed = parseSemver(current)
  if (!parsed) {
    return {
      ok: false,
      reason: "invalid-current",
      message: `Current version is not valid semver: "${current}"`,
    }
  }

  let next: Semver
  switch (bump) {
    case "none":
      next = parsed
      break
    case "patch":
      next = { ...parsed, patch: parsed.patch + 1 }
      break
    case "minor":
      next = { major: parsed.major, minor: parsed.minor + 1, patch: 0 }
      break
    case "major":
      next = { major: parsed.major + 1, minor: 0, patch: 0 }
      break
    default: {
      const explicit = parseSemver(bump)
      if (!explicit) {
        return {
          ok: false,
          reason: "invalid-bump",
          message: `Bump must be patch, minor, major, none, or an explicit semver — got: "${bump}"`,
        }
      }
      next = explicit
    }
  }

  const version = formatSemver(next)
  const tag = desktopTagFor(version)
  const tags = existingTags instanceof Set ? existingTags : new Set(existingTags)
  if (tags.has(tag)) {
    return {
      ok: false,
      reason: "tag-exists",
      message: `Refusing to reuse an existing release tag: ${tag}`,
    }
  }

  return { ok: true, version, tag }
}

/**
 * Replace only the first substring captured by `pattern`'s group 2, leaving
 * everything else — formatting, comments, ordering — byte-for-byte intact.
 * Throws if the field isn't found, so a malformed file fails loudly rather
 * than silently going un-bumped.
 */
function rewriteVersionField(
  contents: string,
  version: string,
  pattern: RegExp,
  fileLabel: string
): string {
  if (!pattern.test(contents)) {
    throw new Error(`No version field found to rewrite in ${fileLabel}`)
  }
  // Non-global pattern → String.replace touches only the first match.
  return contents.replace(pattern, (_full, prefix: string, _old, suffix: string) => {
    return `${prefix}${version}${suffix}`
  })
}

/** Rewrite the top-level `"version"` in a `package.json`'s contents. */
export function setPackageJsonVersion(contents: string, version: string): string {
  return rewriteVersionField(
    contents,
    version,
    /("version"\s*:\s*")([^"]*)(")/,
    "package.json"
  )
}

/** Rewrite the top-level `"version"` in a `tauri.conf.json`'s contents. */
export function setTauriConfVersion(contents: string, version: string): string {
  return rewriteVersionField(
    contents,
    version,
    /("version"\s*:\s*")([^"]*)(")/,
    "tauri.conf.json"
  )
}

/**
 * Rewrite the `[package]` `version` in a `Cargo.toml`'s contents. Anchored to
 * the start of a line so it hits the package version — which leads the file —
 * and not an inline `{ version = "..." }` in a dependency table.
 */
export function setCargoTomlVersion(contents: string, version: string): string {
  return rewriteVersionField(
    contents,
    version,
    /^(version\s*=\s*")([^"]*)(")/m,
    "Cargo.toml"
  )
}
