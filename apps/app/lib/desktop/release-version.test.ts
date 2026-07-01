import { describe, expect, it } from "vitest"

import {
  DESKTOP_TAG_PREFIX,
  desktopTagFor,
  resolveVersion,
  setCargoTomlVersion,
  setPackageJsonVersion,
  setTauriConfVersion,
} from "./release-version"

describe("resolveVersion", () => {
  it("bumps patch, minor, and major", () => {
    expect(resolveVersion("1.2.3", "patch")).toEqual({
      ok: true,
      version: "1.2.4",
      tag: "desktop-v1.2.4",
    })
    expect(resolveVersion("1.2.3", "minor")).toEqual({
      ok: true,
      version: "1.3.0",
      tag: "desktop-v1.3.0",
    })
    expect(resolveVersion("1.2.3", "major")).toEqual({
      ok: true,
      version: "2.0.0",
      tag: "desktop-v2.0.0",
    })
  })

  it("resets lower components on minor and major bumps", () => {
    expect(resolveVersion("1.4.9", "minor")).toMatchObject({ version: "1.5.0" })
    expect(resolveVersion("1.4.9", "major")).toMatchObject({ version: "2.0.0" })
  })

  it("accepts an explicit semver as the next version", () => {
    expect(resolveVersion("0.0.1", "0.2.0")).toEqual({
      ok: true,
      version: "0.2.0",
      tag: "desktop-v0.2.0",
    })
  })

  it("passes the current version through unchanged for `none`", () => {
    expect(resolveVersion("0.3.1", "none")).toEqual({
      ok: true,
      version: "0.3.1",
      tag: "desktop-v0.3.1",
    })
  })

  it("rejects a version whose desktop-v tag already exists", () => {
    const existing = ["desktop-v0.0.9", "desktop-v0.1.0"]
    const result = resolveVersion("0.0.9", "minor", existing)
    expect(result).toEqual({
      ok: false,
      reason: "tag-exists",
      message: "Refusing to reuse an existing release tag: desktop-v0.1.0",
    })
  })

  it("applies the tag guard to `none` and explicit-semver resolutions too", () => {
    const existing = new Set(["desktop-v0.3.1", "desktop-v2.0.0"])
    expect(resolveVersion("0.3.1", "none", existing)).toMatchObject({
      ok: false,
      reason: "tag-exists",
    })
    expect(resolveVersion("0.0.1", "2.0.0", existing)).toMatchObject({
      ok: false,
      reason: "tag-exists",
    })
  })

  it("allows a bump whose tag does not collide with an existing one", () => {
    const existing = ["desktop-v0.0.1", "desktop-v0.0.2"]
    expect(resolveVersion("0.0.2", "patch", existing)).toMatchObject({
      ok: true,
      version: "0.0.3",
    })
  })

  it("rejects a non-semver current version", () => {
    expect(resolveVersion("v1.2", "patch")).toMatchObject({
      ok: false,
      reason: "invalid-current",
    })
  })

  it("rejects a bump that is neither a keyword nor valid semver", () => {
    expect(resolveVersion("1.2.3", "1.2")).toMatchObject({
      ok: false,
      reason: "invalid-bump",
    })
    expect(resolveVersion("1.2.3", "banana")).toMatchObject({
      ok: false,
      reason: "invalid-bump",
    })
  })
})

describe("desktopTagFor", () => {
  it("prefixes the version with the release tag prefix", () => {
    expect(desktopTagFor("1.2.3")).toBe(`${DESKTOP_TAG_PREFIX}1.2.3`)
    expect(desktopTagFor("1.2.3")).toBe("desktop-v1.2.3")
  })
})

describe("per-file version rewrites", () => {
  const packageJson = `{
  "name": "desktop",
  "version": "0.0.1",
  "private": true,
  "dependencies": {
    "some-dep": "0.0.1"
  }
}
`

  const tauriConf = `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Screenplay",
  "version": "0.0.1",
  "identifier": "space.screenplay.desktop"
}
`

  const cargoToml = `[package]
name = "screenplay-desktop"
version = "0.0.1"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
`

  it("rewrites package.json version while preserving surrounding content", () => {
    const next = setPackageJsonVersion(packageJson, "0.1.0")
    expect(next).toContain(`"version": "0.1.0"`)
    // The identically-valued dependency string must be untouched.
    expect(next).toContain(`"some-dep": "0.0.1"`)
    expect(next).toBe(packageJson.replace(`"version": "0.0.1"`, `"version": "0.1.0"`))
  })

  it("rewrites tauri.conf.json version while preserving surrounding content", () => {
    const next = setTauriConfVersion(tauriConf, "0.1.0")
    expect(next).toContain(`"version": "0.1.0"`)
    expect(next).toBe(tauriConf.replace(`"version": "0.0.1"`, `"version": "0.1.0"`))
  })

  it("rewrites the Cargo.toml package version, not a dependency's version", () => {
    const next = setCargoTomlVersion(cargoToml, "0.1.0")
    expect(next).toContain(`version = "0.1.0"`)
    // The inline dependency version stays pinned.
    expect(next).toContain(`tauri = { version = "2"`)
    expect(next).toBe(
      cargoToml.replace(`version = "0.0.1"`, `version = "0.1.0"`)
    )
  })

  it("throws when a file carries no version field to rewrite", () => {
    expect(() => setPackageJsonVersion(`{ "name": "x" }`, "1.0.0")).toThrow()
    expect(() => setCargoTomlVersion(`[package]\nname = "x"\n`, "1.0.0")).toThrow()
  })

  it("bumps all three files in lockstep to the same resolved version", () => {
    const resolved = resolveVersion("0.0.1", "minor")
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.version).toBe("0.1.0")

    const nextPackage = setPackageJsonVersion(packageJson, resolved.version)
    const nextTauri = setTauriConfVersion(tauriConf, resolved.version)
    const nextCargo = setCargoTomlVersion(cargoToml, resolved.version)

    expect(nextPackage).toContain(`"version": "0.1.0"`)
    expect(nextTauri).toContain(`"version": "0.1.0"`)
    expect(nextCargo).toContain(`version = "0.1.0"`)
  })
})
