import { describe, expect, it } from "vitest"

import type { GitHubRepo } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { NewRepoSource } from "@/lib/github-local/types"
import type { RepoPickerSelection } from "@/components/repo-picker"
import {
  resolvePresetUpsert,
  resolveRepoData,
  type PresetUpsertMeta,
  type ResolvedRepoSettings,
} from "@/lib/add-repo/resolver"

const META = { id: "repo-1", createdAt: 1_700_000_000_000 }

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

describe("resolveRepoData — confirm decision", () => {
  describe("unconfigured GitHub-repo pick", () => {
    const pick: RepoPickerSelection = { kind: "repo", repo: REPO }

    it("carries the resolved settings into the created RepoData", () => {
      const data = resolveRepoData(pick, SETTINGS, META)
      expect(data).toEqual({
        id: "repo-1",
        name: "",
        repoFullName: "acme/widget",
        repoOwner: "acme",
        repoName: "widget",
        defaultBranch: "main",
        cloneUrl: "https://github.com/acme/widget.git",
        setupScript: "pnpm install",
        devScript: "pnpm dev",
        devServerPort: 5173,
        envVars: "DATABASE_URL=postgres://local",
        createdAt: META.createdAt,
      })
    })

    it("falls back to today's plain defaults when no settings are given", () => {
      const data = resolveRepoData(pick, undefined, META)
      expect(data).toMatchObject({
        setupScript: "",
        devScript: "",
        devServerPort: 3000,
        envVars: "",
      })
      expect(data.copyPatterns).toBeUndefined()
    })
  })

  describe("clone-URL / local-folder source pick", () => {
    const folderSource: NewRepoSource = {
      name: "widget",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "",
      localPath: "/Users/me/widget",
    }
    const pick: RepoPickerSelection = { kind: "source", source: folderSource }

    it("defaults a local-folder Repo's copy patterns to .env* with no settings", () => {
      const data = resolveRepoData(pick, undefined, META)
      expect(data).toMatchObject({
        localPath: "/Users/me/widget",
        setupScript: "",
        devScript: "",
        devServerPort: 3000,
        copyPatterns: ".env*",
      })
    })

    it("uses resolved settings (incl. copy patterns) when present", () => {
      const data = resolveRepoData(
        pick,
        { ...SETTINGS, copyPatterns: "apps/*/.env*" },
        META
      )
      expect(data).toMatchObject({
        setupScript: "pnpm install",
        devScript: "pnpm dev",
        devServerPort: 5173,
        copyPatterns: "apps/*/.env*",
      })
    })

    it("leaves copy patterns undefined for a non-folder source", () => {
      const urlSource: NewRepoSource = {
        name: "widget",
        repoFullName: "https://example.com/widget.git",
        repoOwner: "",
        repoName: "",
        defaultBranch: "main",
        cloneUrl: "https://example.com/widget.git",
      }
      const data = resolveRepoData(
        { kind: "source", source: urlSource },
        undefined,
        META
      )
      expect(data.copyPatterns).toBeUndefined()
    })
  })

  describe("saved-preset pick", () => {
    const config: RepoConfig = {
      id: "cfg-1",
      name: "web",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: true,
      setupScript: "npm ci",
      devScript: "npm start",
      devServerPort: 8080,
      envVars: "FOO=bar",
      copyPatterns: ".env.local",
      defaultIframeLayerSizeId: "desktop",
      systemPrompt: "Root is apps/web.",
      createdAt: 1,
      updatedAt: 2,
    }
    const pick: RepoPickerSelection = { kind: "config", config }

    it("carries the preset's own settings and ignores any passed settings", () => {
      // A preset never routes through the modal, so even if settings were
      // somehow supplied the preset's stored values must win.
      const data = resolveRepoData(pick, SETTINGS, META)
      expect(data).toMatchObject({
        name: "web",
        setupScript: "npm ci",
        devScript: "npm start",
        devServerPort: 8080,
        envVars: "FOO=bar",
        copyPatterns: ".env.local",
        defaultIframeLayerSizeId: "desktop",
        systemPrompt: "Root is apps/web.",
        localPath: undefined,
      })
    })
  })
})

const UPSERT_META: PresetUpsertMeta = {
  id: "preset-9",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
}

describe("resolvePresetUpsert — confirm's save-as-preset decision", () => {
  const repoPick: RepoPickerSelection = { kind: "repo", repo: REPO }

  it("yields no upsert when save is off", () => {
    expect(
      resolvePresetUpsert(repoPick, SETTINGS, [], UPSERT_META, false)
    ).toBe(null)
  })

  it("mints a fresh default preset when none matches the repo", () => {
    const plan = resolvePresetUpsert(repoPick, SETTINGS, [], UPSERT_META, true)
    expect(plan).toEqual({
      id: "preset-9",
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

  it("updates an existing default preset in place, preserving id/createdAt and advanced fields", () => {
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
    const plan = resolvePresetUpsert(
      repoPick,
      SETTINGS,
      [existing],
      UPSERT_META,
      true
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

  it("does not match a non-default (named) preset for the same repo", () => {
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
    const plan = resolvePresetUpsert(
      repoPick,
      SETTINGS,
      [named],
      UPSERT_META,
      true
    )
    // The named preset is untouched; a fresh default preset is minted.
    expect(plan?.id).toBe("preset-9")
    expect(plan?.name).toBe("")
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
    const plan = resolvePresetUpsert(
      { kind: "source", source: folderSource },
      { ...SETTINGS, copyPatterns: "apps/*/.env*" },
      [],
      UPSERT_META,
      true
    )
    expect(plan).toMatchObject({
      name: "",
      repoFullName: "acme/widget",
      localPath: "/Users/me/widget",
      private: false,
      copyPatterns: "apps/*/.env*",
    })
  })

  it("never re-saves a preset for a saved-preset pick", () => {
    const config: RepoConfig = {
      id: "cfg-1",
      name: "web",
      repoFullName: "acme/widget",
      repoOwner: "acme",
      repoName: "widget",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/widget.git",
      private: true,
      setupScript: "npm ci",
      devScript: "npm start",
      devServerPort: 8080,
      envVars: "",
      createdAt: 1,
      updatedAt: 2,
    }
    expect(
      resolvePresetUpsert(
        { kind: "config", config },
        SETTINGS,
        [],
        UPSERT_META,
        true
      )
    ).toBe(null)
  })
})
