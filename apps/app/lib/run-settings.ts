import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"

/**
 * A Repository's run settings (#1495): what every new Workspace of it starts
 * from. One shape for your Repositories (`RepoConfig`), the Canvas Repos
 * switched on from them (`RepoData`) and the three forms that edit them (the
 * add flow, Settings > Repositories > Edit, and a Canvas Repo's settings), so
 * defaults, port validation, cleanup and equality live here once. Env vars
 * are not part of it: their values never ride the room doc (#1416).
 */
export interface RunSettings {
  setupScript: string
  devScript: string
  devServerPort: number
  /** Desktop-only glob patterns copied into each worktree. */
  copyPatterns?: string
  /** Preset id from `lib/iframe-layer-sizes`; unset is the default size. */
  defaultIframeLayerSizeId?: string
  /** Extra instructions appended to the agent's system prompt. */
  systemPrompt?: string
}

/** The port a dev server listens on when nothing says otherwise. */
export const DEFAULT_DEV_SERVER_PORT = 3000

/** The run settings as a form edits them: every field text, the port a text
 *  input, unset fields at their defaults. */
export interface RunSettingsFields {
  setupScript: string
  devScript: string
  devServerPort: string
  copyPatterns: string
  defaultIframeLayerSizeId: string
  systemPrompt: string
}

/** Copy just the run settings off a Repository, a Canvas Repo or anything
 *  else that carries them, so no caller lists the fields by hand. */
export function pickRunSettings(source: RunSettings): RunSettings {
  return {
    setupScript: source.setupScript,
    devScript: source.devScript,
    devServerPort: source.devServerPort,
    copyPatterns: source.copyPatterns,
    defaultIframeLayerSizeId: source.defaultIframeLayerSizeId,
    systemPrompt: source.systemPrompt,
  }
}

/**
 * A form's starting values: `from`'s run settings, or the defaults for any it
 * doesn't set. With nothing given, a new Repository's plain defaults.
 */
export function runSettingsFields(
  from: Partial<RunSettings> = {}
): RunSettingsFields {
  return {
    setupScript: from.setupScript ?? "",
    devScript: from.devScript ?? "",
    devServerPort: String(from.devServerPort ?? DEFAULT_DEV_SERVER_PORT),
    copyPatterns: from.copyPatterns ?? "",
    defaultIframeLayerSizeId:
      from.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID,
    systemPrompt: from.systemPrompt ?? "",
  }
}

/** The port a text field holds, or `undefined` when it isn't one (1–65535). */
export function parseDevServerPort(text: string): number | undefined {
  const port = Number.parseInt(text, 10)
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : undefined
}

/** Whether a form's run settings can be saved: today, a valid port. */
export function validateRunSettings(fields: RunSettingsFields): boolean {
  return parseDevServerPort(fields.devServerPort) !== undefined
}

/**
 * Run settings as they're stored: text trimmed, and a blank copy patterns or
 * system prompt left unset rather than stored empty.
 */
export function cleanRunSettings(settings: RunSettings): RunSettings {
  return {
    setupScript: settings.setupScript.trim(),
    devScript: settings.devScript.trim(),
    devServerPort: settings.devServerPort,
    copyPatterns: settings.copyPatterns?.trim() || undefined,
    defaultIframeLayerSizeId: settings.defaultIframeLayerSizeId,
    systemPrompt: settings.systemPrompt?.trim() || undefined,
  }
}

/** A form's run settings, cleaned for saving; `undefined` while they aren't
 *  valid (see {@link validateRunSettings}). */
export function parseRunSettings(
  fields: RunSettingsFields
): RunSettings | undefined {
  const devServerPort = parseDevServerPort(fields.devServerPort)
  if (devServerPort === undefined) return undefined
  return cleanRunSettings({ ...fields, devServerPort })
}

/**
 * Whether two sets of run settings mean the same thing: unset fields at their
 * defaults and text trimmed, so a Repo saved through a form that fills or
 * trims them never reads as changed (#1479).
 */
export function sameRunSettings(
  a: Partial<RunSettings>,
  b: Partial<RunSettings>
): boolean {
  const x = comparable(a)
  const y = comparable(b)
  return x.every((v, i) => v === y[i])
}

function comparable(settings: Partial<RunSettings>) {
  return [
    settings.setupScript?.trim() ?? "",
    settings.devScript?.trim() ?? "",
    settings.devServerPort ?? DEFAULT_DEV_SERVER_PORT,
    settings.copyPatterns?.trim() ?? "",
    settings.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID,
    settings.systemPrompt?.trim() ?? "",
  ]
}
