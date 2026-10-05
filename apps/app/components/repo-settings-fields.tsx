"use client"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { EyeIcon, EyeSlashIcon } from "@workspace/ui/components/icons"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { IframeLayerSizeSelect } from "@/components/iframe-layer-size-select"
import { isLocalBuild } from "@/lib/local-mode"
import {
  DEFAULT_DEV_SERVER_PORT,
  type RunSettingsFields,
} from "@/lib/run-settings"

/**
 * Which half of the field set to render. The definitions stay a single source
 * of truth (PRD #673): the add-repo modal renders `essential` always plus
 * `advanced` behind its expander (#681), while the in-room Project settings
 * modal and the homescreen preset form render `all` (the default), unchanged.
 *
 * - `essential` — setup script, run script, (hosted only) dev server port, and
 *   the env field (environment variables / files-to-copy) where one applies.
 * - `advanced` — default frame size, system prompt, and (add-modal only) the
 *   optional preset name.
 * - `all` — every field, in the order below. Since the env field is the last
 *   `essential` field and the first thing `advanced` used to render, the `all`
 *   order is unchanged by the split.
 */
export type RepoSettingsSection = "essential" | "advanced" | "all"

interface RepoSettingsFieldsProps {
  /**
   * Namespaces the field `id`/`htmlFor` pairs so the same component can render
   * twice on a page (e.g. two open dialogs) without colliding label targets.
   */
  idPrefix: string
  /** Which half of the fields to render. Defaults to `all`. */
  section?: RepoSettingsSection
  /**
   * Whether to render the env field at all (#681). Env-field presence is
   * *source-dependent*, not just build-dependent: hosted and desktop
   * local-folder each have an injection path (env vars / files-to-copy), but a
   * desktop GitHub-clone has none, so its add modal passes `false`. Defaults to
   * `true` — the two `all`-rendering modals keep showing it, as before.
   */
  showEnvField?: boolean
  setupScript: string
  onSetupScriptChange: (value: string) => void
  devScript: string
  onDevScriptChange: (value: string) => void
  devServerPort: string
  onDevServerPortChange: (value: string) => void
  envVars: string
  onEnvVarsChange: (value: string) => void
  /**
   * A Canvas Repo's env vars (#1416): the values stay on the server, so the
   * field shows only the names that are set. The person who added the Repo
   * reveals the values to edit them; everyone else can only add their own.
   * Absent on the forms that edit your own Repositories, which show the
   * values as they are.
   */
  envVarsAccess?: EnvVarsAccess
  copyPatterns: string
  onCopyPatternsChange: (value: string) => void
  defaultIframeLayerSizeId: string
  onDefaultIframeLayerSizeIdChange: (value: string) => void
  systemPrompt: string
  onSystemPromptChange: (value: string) => void
  /**
   * Optional preset name, rendered last in `advanced` (#681). Present only when
   * `onPresetNameChange` is supplied — the add modal's advanced section — so the
   * two `all`-rendering modals (which own their own name/label field) never grow
   * a duplicate one.
   */
  presetName?: string
  onPresetNameChange?: (value: string) => void
}

export interface EnvVarsAccess {
  /** The names already set on this Canvas. */
  names: string[]
  /** This person added the Repo, so Reveal is theirs. */
  owned: boolean
  /** There are stored values to reveal and hide again. */
  hideable: boolean
  /** The adder's field, read-only and masked while the values are hidden. */
  locked: boolean
  revealing: boolean
  onReveal: () => void
  onHide: () => void
}

/** What the env field says under it, by who's looking. Kept to what's true:
 *  values are hidden in settings, not out of reach of the Workspace. */
function envVarsDescription(access: EnvVarsAccess | undefined): string {
  const base = "One KEY=value per line. Every chat gets them."
  if (!access) return base
  if (access.owned) return `${base} Only you can see the values.`
  if (access.names.length === 0) return base
  return "Only the person who added this repository can see the values. Add KEY=value here to set your own on this canvas."
}

/**
 * The run-settings value and change props for {@link RepoSettingsFields}, from
 * one `RunSettingsFields` state and a setter per field, so a form keeps its
 * run settings as one value rather than a `useState` each.
 */
export function runSettingsFieldProps(
  fields: RunSettingsFields,
  set: (field: keyof RunSettingsFields) => (value: string) => void
) {
  return {
    setupScript: fields.setupScript,
    onSetupScriptChange: set("setupScript"),
    devScript: fields.devScript,
    onDevScriptChange: set("devScript"),
    devServerPort: fields.devServerPort,
    onDevServerPortChange: set("devServerPort"),
    copyPatterns: fields.copyPatterns,
    onCopyPatternsChange: set("copyPatterns"),
    defaultIframeLayerSizeId: fields.defaultIframeLayerSizeId,
    onDefaultIframeLayerSizeIdChange: set("defaultIframeLayerSizeId"),
    systemPrompt: fields.systemPrompt,
    onSystemPromptChange: set("systemPrompt"),
  } satisfies Partial<RepoSettingsFieldsProps>
}

/**
 * The shared run-settings body for a repo: the fields that mean the same thing
 * on the homepage preset form and the canvas room-sidebar settings dialog.
 *
 * Built on shadcn's Field primitives so labels, descriptions, and spacing match
 * the rest of the design system instead of hand-rolled markup.
 *
 * Purely presentational — each surface owns the form state (one
 * `RunSettingsFields` value, see {@link runSettingsFieldProps}) and the per-surface chrome (name field, repo identity, save
 * actions). This component only renders the body, so the two surfaces can't
 * drift apart again.
 */
export function RepoSettingsFields({
  idPrefix,
  section = "all",
  showEnvField = true,
  setupScript,
  onSetupScriptChange,
  devScript,
  onDevScriptChange,
  devServerPort,
  onDevServerPortChange,
  envVars,
  onEnvVarsChange,
  envVarsAccess,
  copyPatterns,
  onCopyPatternsChange,
  defaultIframeLayerSizeId,
  onDefaultIframeLayerSizeIdChange,
  systemPrompt,
  onSystemPromptChange,
  presetName,
  onPresetNameChange,
}: RepoSettingsFieldsProps) {
  const hiddenNames =
    envVarsAccess && (!envVarsAccess.owned || envVarsAccess.locked)
      ? envVarsAccess.names
      : []
  const showEssential = section === "essential" || section === "all"
  const showAdvanced = section === "advanced" || section === "all"
  return (
    <FieldGroup>
      {showEssential && (
        <>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-setup`}>Setup script</FieldLabel>
            <Input
              id={`${idPrefix}-setup`}
              value={setupScript}
              onChange={(e) => onSetupScriptChange(e.target.value)}
              placeholder="npm install"
              className="font-mono"
            />
            <FieldDescription>
              Runs once when a chat’s code is set up.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-dev`}>Run script</FieldLabel>
            <Input
              id={`${idPrefix}-dev`}
              value={devScript}
              onChange={(e) => onDevScriptChange(e.target.value)}
              placeholder="npm run dev"
              className="font-mono"
            />
            <FieldDescription>
              Starts the dev server your frames preview.
            </FieldDescription>
          </Field>

          {/* On the desktop build the configured port is a logical key only —
          portless assigns and delivers the real port (ADR 0010) — so there
          is nothing for the user to set. Hosted keeps the field: there the
          dev server must bind this exact port. */}
          {!isLocalBuild && (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-port`}>
                Dev server port
              </FieldLabel>
              <Input
                id={`${idPrefix}-port`}
                type="number"
                min={1}
                max={65535}
                value={devServerPort}
                onChange={(e) => onDevServerPortChange(e.target.value)}
                placeholder={String(DEFAULT_DEV_SERVER_PORT)}
                className="font-mono"
              />
              <FieldDescription>
                The port your dev server listens on.
              </FieldDescription>
            </Field>
          )}

          {/* The env field is source-dependent (#681): a desktop GitHub-clone
          has no injection path and passes `showEnvField={false}`; hosted shows
          env vars, desktop local-folder shows files-to-copy. It's the last
          essential field, so the `all` order is unchanged by the move. */}
          {showEnvField &&
            (isLocalBuild ? (
              // Desktop mode: instead of spelling env vars out, glob patterns of
              // files (e.g. `.env*`) carried over from the original checkout
              // into each workspace's worktree.
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-copy-patterns`}>
                  Files to copy
                </FieldLabel>
                <Textarea
                  id={`${idPrefix}-copy-patterns`}
                  value={copyPatterns}
                  onChange={(e) => onCopyPatternsChange(e.target.value)}
                  placeholder={".env*\napps/*/.env*"}
                  rows={3}
                  className="[field-sizing:fixed] max-w-full resize-y font-mono text-xs"
                />
                <FieldDescription>
                  Files from your folder to copy into each chat’s code, like
                  .env. One pattern per line.
                </FieldDescription>
              </Field>
            ) : (
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor={`${idPrefix}-envvars`}>
                    Environment variables
                  </FieldLabel>
                  {/* Reveal and Hide share one spot, and the button's extra
                  height is pulled in so the label row matches the others. */}
                  {envVarsAccess?.hideable &&
                    (envVarsAccess.locked ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-my-1"
                        onClick={envVarsAccess.onReveal}
                        disabled={envVarsAccess.revealing}
                      >
                        {envVarsAccess.revealing ? (
                          <Spinner
                            data-icon="inline-start"
                            className="size-3"
                          />
                        ) : (
                          <EyeIcon data-icon="inline-start" />
                        )}
                        Reveal values
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-my-1"
                        onClick={envVarsAccess.onHide}
                      >
                        <EyeSlashIcon data-icon="inline-start" />
                        Hide values
                      </Button>
                    ))}
                </div>
                <Textarea
                  id={`${idPrefix}-envvars`}
                  value={envVars}
                  onChange={(e) => onEnvVarsChange(e.target.value)}
                  disabled={envVarsAccess?.locked}
                  // The names already set, values masked, until someone types.
                  placeholder={
                    hiddenNames.length > 0
                      ? hiddenNames.map((n) => `${n}=••••••`).join("\n")
                      : "KEY=value\nANOTHER_KEY=value"
                  }
                  rows={4}
                  className="[field-sizing:fixed] max-w-full resize-y font-mono text-xs"
                />
                <FieldDescription>
                  {envVarsDescription(envVarsAccess)}
                </FieldDescription>
              </Field>
            ))}
        </>
      )}

      {showAdvanced && (
        <>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-default-frame-size`}>
              Default frame size
            </FieldLabel>
            <IframeLayerSizeSelect
              id={`${idPrefix}-default-frame-size`}
              value={defaultIframeLayerSizeId}
              onChange={onDefaultIframeLayerSizeIdChange}
            />
            <FieldDescription>The size new frames open at.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-system-prompt`}>
              Agent instructions
            </FieldLabel>
            <Textarea
              id={`${idPrefix}-system-prompt`}
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder="Work in the Next.js app under apps/web."
              rows={4}
              className="[field-sizing:fixed] max-w-full resize-y text-xs"
            />
            <FieldDescription>
              Extra instructions for the agent in this repository, like which
              app folder to work in.
            </FieldDescription>
          </Field>

          {/* Add-modal only (#681): keys the Repository upsert. Empty → the
          repo's "default" Repository. Absent on the two `all`-rendering
          modals, which own their own name field. */}
          {onPresetNameChange && (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-preset-name`}>Name</FieldLabel>
              <Input
                id={`${idPrefix}-preset-name`}
                value={presetName ?? ""}
                onChange={(e) => onPresetNameChange(e.target.value)}
              />
              <FieldDescription>
                Optional. A short name like “web” or “api”, to tell apart two
                setups of one repository.
              </FieldDescription>
            </Field>
          )}
        </>
      )}
    </FieldGroup>
  )
}
