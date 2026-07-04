import { describe, expect, it } from "vitest"

import type { GitHubRepo } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { NewRepoSource } from "@/lib/github-local/types"
import type { RepoPickerSelection } from "@/components/repo-picker"
import {
  mergeDetectedSettings,
  resolvePresetUpsert,
  resolveRepoData,
  type DetectableFields,
  type DetectedSettings,
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

    it("seeds the live Project's display name from the advanced preset name", () => {
      const data = resolveRepoData(
        pick,
        { ...SETTINGS, presetName: "  web  " },
        META
      )
      // Trimmed, mirroring how a saved-preset pick seeds `name` from config.name.
      expect(data.name).toBe("web")
    })

    it("leaves the name blank when no preset name is given", () => {
      expect(resolveRepoData(pick, SETTINGS, META).name).toBe("")
      expect(
        resolveRepoData(pick, { ...SETTINGS, presetName: "   " }, META).name
      ).toBe("")
    })

    it("carries the advanced frame size and system prompt into the RepoData", () => {
      const data = resolveRepoData(
        pick,
        { ...SETTINGS, defaultIframeLayerSizeId: "desktop", systemPrompt: "hi" },
        META
      )
      expect(data).toMatchObject({
        defaultIframeLayerSizeId: "desktop",
        systemPrompt: "hi",
      })
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

  it("keys the upsert on the given name — updates the matching named preset", () => {
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
    const plan = resolvePresetUpsert(
      repoPick,
      { ...SETTINGS, presetName: "web" },
      [existingDefault, existingWeb],
      UPSERT_META,
      true
    )
    // The "web" preset is updated in place; the same-repo default is untouched.
    expect(plan?.id).toBe("cfg-web")
    expect(plan?.name).toBe("web")
    expect(plan?.setupScript).toBe("pnpm install")
    expect(plan?.createdAt).toBe(111)
  })

  it("mints a new preset when the given name matches no existing one", () => {
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
    const plan = resolvePresetUpsert(
      repoPick,
      { ...SETTINGS, presetName: "api" },
      [existingDefault],
      UPSERT_META,
      true
    )
    // A different name never collides with the default — a fresh preset is minted.
    expect(plan?.id).toBe("preset-9")
    expect(plan?.name).toBe("api")
  })

  it("trims the preset name before keying the upsert", () => {
    const plan = resolvePresetUpsert(
      repoPick,
      { ...SETTINGS, presetName: "  api  " },
      [],
      UPSERT_META,
      true
    )
    expect(plan?.name).toBe("api")
  })

  it("saves the advanced frame size and system prompt the modal set", () => {
    const plan = resolvePresetUpsert(
      repoPick,
      { ...SETTINGS, defaultIframeLayerSizeId: "desktop", systemPrompt: "hi" },
      [],
      UPSERT_META,
      true
    )
    expect(plan).toMatchObject({
      defaultIframeLayerSizeId: "desktop",
      systemPrompt: "hi",
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
