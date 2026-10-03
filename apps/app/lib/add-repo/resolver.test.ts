import { describe, expect, it } from "vitest"

import type { GitHubRepo } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { NewRepoSource } from "@/lib/github-local/types"
import type { RepoPickerSelection } from "@/components/repo-picker"
import {
  mergeDetectedSettings,
  resolveNewRepository,
  type DetectableFields,
  type DetectedSettings,
  type RepositoryMeta,
  type ResolvedRepoSettings,
} from "@/lib/add-repo/resolver"

const REPO: GitHubRepo = {
  id: 42,
  fullName: "acme/widget",
  name: "widget",
  private: false,
  defaultBranch: "main",
  cloneUrl: "https://github.com/acme/widget.git",
  htmlUrl: "https://github.com/acme/widget",
  owner: "acme",
  pushedAt: "2026-01-01T00:00:00Z",
}

const SETTINGS: ResolvedRepoSettings = {
  setupScript: "pnpm install",
  devScript: "pnpm dev",
  devServerPort: 5173,
  envVars: "DATABASE_URL=postgres://local",
}

const UPSERT_META: RepositoryMeta = {
  id: "repository-9",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
}

describe("resolveNewRepository — New repository's confirm decision", () => {
  const repoPick: RepoPickerSelection = { kind: "repo", repo: REPO }

  it("mints a fresh default repository when none matches the repo", () => {
    const plan = resolveNewRepository(repoPick, SETTINGS, [], UPSERT_META)
    expect(plan).toEqual({
      id: "repository-9",
      name: "",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: false,
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 5173,
      envVars: "DATABASE_URL=postgres://local",
      copyPatterns: undefined,
      createdAt: UPSERT_META.createdAt,
      updatedAt: UPSERT_META.updatedAt,
    })
  })

  it("updates an existing default repository in place, preserving id/createdAt and advanced fields", () => {
    const existing: RepoConfig = {
      id: "cfg-existing",
      name: "",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: false,
      setupScript: "old install",
      devScript: "old dev",
      devServerPort: 3000,
      envVars: "OLD=1",
      copyPatterns: ".env.old",
      defaultIframeLayerSizeId: "desktop",
      systemPrompt: "Keep me.",
      createdAt: 111,
      updatedAt: 222,
    }
    const plan = resolveNewRepository(
      repoPick,
      SETTINGS,
      [existing],
      UPSERT_META
    )
    expect(plan).toEqual({
      id: "cfg-existing",
      name: "",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: false,
      // Resolved run settings overwrite the stored ones…
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 5173,
      envVars: "DATABASE_URL=postgres://local",
      copyPatterns: undefined,
      // …but identity, id, createdAt, and advanced fields are preserved.
      defaultIframeLayerSizeId: "desktop",
      systemPrompt: "Keep me.",
      createdAt: 111,
      updatedAt: UPSERT_META.updatedAt,
    })
  })

  it("keys the upsert on the given name — updates the matching named repository", () => {
    const existingWeb: RepoConfig = {
      id: "cfg-web",
      name: "web",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: false,
      setupScript: "old install",
      devScript: "old dev",
      devServerPort: 3000,
      envVars: "OLD=1",
      createdAt: 111,
      updatedAt: 222,
    }
    const existingDefault: RepoConfig = {
      ...existingWeb,
      id: "cfg-default",
      name: "",
    }
    const plan = resolveNewRepository(
      repoPick,
      { ...SETTINGS, presetName: "web" },
      [existingDefault, existingWeb],
      UPSERT_META
    )
    // The "web" repository is updated in place; the same-repo default is untouched.
    expect(plan.id).toBe("cfg-web")
    expect(plan.name).toBe("web")
    expect(plan.setupScript).toBe("pnpm install")
    expect(plan.createdAt).toBe(111)
  })

  it("mints a new repository when the given name matches no existing one", () => {
    const existingDefault: RepoConfig = {
      id: "cfg-default",
      name: "",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: false,
      setupScript: "old install",
      devScript: "old dev",
      devServerPort: 3000,
      envVars: "OLD=1",
      createdAt: 111,
      updatedAt: 222,
    }
    const plan = resolveNewRepository(
      repoPick,
      { ...SETTINGS, presetName: "api" },
      [existingDefault],
      UPSERT_META
    )
    // A different name never collides with the default — a fresh repository is minted.
    expect(plan.id).toBe("repository-9")
    expect(plan.name).toBe("api")
  })

  it("trims the repository name before keying the upsert", () => {
    const plan = resolveNewRepository(
      repoPick,
      { ...SETTINGS, presetName: "  api  " },
      [],
      UPSERT_META
    )
    expect(plan.name).toBe("api")
  })

  it("saves the advanced frame size and system prompt the modal set", () => {
    const plan = resolveNewRepository(
      repoPick,
      { ...SETTINGS, defaultIframeLayerSizeId: "desktop", systemPrompt: "hi" },
      [],
      UPSERT_META
    )
    expect(plan).toMatchObject({
      defaultIframeLayerSizeId: "desktop",
      systemPrompt: "hi",
    })
  })

  it("does not match a non-default (named) repository for the same repo", () => {
    const named: RepoConfig = {
      id: "cfg-named",
      name: "web",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: false,
      setupScript: "npm ci",
      devScript: "npm start",
      devServerPort: 8080,
      envVars: "",
      createdAt: 1,
      updatedAt: 2,
    }
    const plan = resolveNewRepository(repoPick, SETTINGS, [named], UPSERT_META)
    // The named repository is untouched; a fresh default repository is minted.
    expect(plan.id).toBe("repository-9")
    expect(plan.name).toBe("")
  })

  it("saves a local-folder source's identity with localPath and private=false", () => {
    const folderSource: NewRepoSource = {
      name: "widget",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "",
      localPath: "/Users/me/widget",
    }
    const plan = resolveNewRepository(
      { kind: "source", source: folderSource },
      { ...SETTINGS, copyPatterns: "apps/*/.env*" },
      [],
      UPSERT_META
    )
    expect(plan).toMatchObject({
      name: "",
      repoFullName: "acme/widget",
      localPath: "/Users/me/widget",
      private: false,
      copyPatterns: "apps/*/.env*",
    })
  })
})

describe("mergeDetectedSettings — seed/merge decision", () => {
  const DEFAULTS: DetectableFields = {
    setupScript: "",
    devScript: "",
    devServerPort: "3000",
  }
  const DETECTED: DetectedSettings = {
    setupScript: "pnpm install",
    devScript: "pnpm dev",
    devServerPort: 5173,
  }

  it("fills every untouched field from detection", () => {
    expect(mergeDetectedSettings(DEFAULTS, DETECTED, {})).toEqual({
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: "5173", // number stringified for the text field
    })
  })

  it("never clobbers a dirtied field, keeping the user's value", () => {
    const current: DetectableFields = {
      setupScript: "make install", // user typed this
      devScript: "",
      devServerPort: "3000",
    }
    expect(
      mergeDetectedSettings(current, DETECTED, { setupScript: true })
    ).toEqual({
      setupScript: "make install", // preserved
      devScript: "pnpm dev", // still filled
      devServerPort: "5173",
    })
  })

  it("preserves a dirtied field even when it matches a plain default", () => {
    // A user who deliberately blanked or re-typed the default is still "dirty":
    // the flag, not the value, decides — so detection must not refill it.
    const current: DetectableFields = { ...DEFAULTS, devServerPort: "3000" }
    const merged = mergeDetectedSettings(current, DETECTED, {
      devServerPort: true,
    })
    expect(merged.devServerPort).toBe("3000")
  })

  it("leaves all fields untouched when every field is dirty", () => {
    const current: DetectableFields = {
      setupScript: "a",
      devScript: "b",
      devServerPort: "9000",
    }
    expect(
      mergeDetectedSettings(current, DETECTED, {
        setupScript: true,
        devScript: true,
        devServerPort: true,
      })
    ).toEqual(current)
  })
})
