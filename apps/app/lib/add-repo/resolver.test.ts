import { describe, expect, it } from "vitest"

import type { GitHubRepo } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { NewRepoSource } from "@/lib/github-local/types"
import type { RepoPickerSelection } from "@/components/repo-picker"
import {
  resolveRepoData,
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
