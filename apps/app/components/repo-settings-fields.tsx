"use client"

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { IframeLayerSizeSelect } from "@/components/iframe-layer-size-select"
import { isLocalBuild } from "@/lib/local-mode"

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

/**
 * The shared run-settings body for a repo: the fields that mean the same thing
 * on the homepage preset form and the canvas room-sidebar settings dialog.
 *
 * Built on shadcn's Field primitives so labels, descriptions, and spacing match
 * the rest of the design system instead of hand-rolled markup.
 *
 * Purely presentational — each surface owns the form state (controlled
 * `useState`) and the per-surface chrome (name field, repo identity, save
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
  copyPatterns,
  onCopyPatternsChange,
  defaultIframeLayerSizeId,
  onDefaultIframeLayerSizeIdChange,
  systemPrompt,
  onSystemPromptChange,
  presetName,
  onPresetNameChange,
}: RepoSettingsFieldsProps) {
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
              Runs once when a workspace is created
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
              Starts the dev server for each frame
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
                placeholder="3000"
                className="font-mono"
              />
              <FieldDescription>
                Port your dev server binds to (1–65535)
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
                  Glob patterns from your checkout, one per line
                </FieldDescription>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-envvars`}>
                  Environment variables
                </FieldLabel>
                <Textarea
                  id={`${idPrefix}-envvars`}
                  value={envVars}
                  onChange={(e) => onEnvVarsChange(e.target.value)}
                  placeholder={"KEY=value\nANOTHER_KEY=value"}
                  rows={4}
                  className="[field-sizing:fixed] max-w-full resize-y font-mono text-xs"
                />
                <FieldDescription>
                  One KEY=value per line, injected into each workspace
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
            <FieldDescription>Size new frames open at</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-system-prompt`}>
              System prompt
            </FieldLabel>
            <Textarea
              id={`${idPrefix}-system-prompt`}
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder="This config targets the Next.js app under apps/web. Treat apps/web as the project root."
              rows={4}
              className="[field-sizing:fixed] max-w-full resize-y text-xs"
            />
            <FieldDescription>
              Appended to the agent&apos;s instructions — handy for monorepo
              context
            </FieldDescription>
          </Field>

          {/* Add-modal only (#681): keys the preset upsert and seeds the
          Project's display name. Empty → the repo's "default" preset. Absent
          on the two `all`-rendering modals, which own their own name field. */}
          {onPresetNameChange && (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-preset-name`}>
                Preset name
              </FieldLabel>
              <Input
                id={`${idPrefix}-preset-name`}
                value={presetName ?? ""}
                onChange={(e) => onPresetNameChange(e.target.value)}
                placeholder="default"
              />
              <FieldDescription>
                Optional, e.g. “web” or “api” — tells apart Projects for the same
                repo
              </FieldDescription>
            </Field>
          )}
        </>
      )}
    </FieldGroup>
  )
}
