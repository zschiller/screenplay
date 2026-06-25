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

interface RepoSettingsFieldsProps {
  /**
   * Namespaces the field `id`/`htmlFor` pairs so the same component can render
   * twice on a page (e.g. two open dialogs) without colliding label targets.
   */
  idPrefix: string
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
}: RepoSettingsFieldsProps) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-setup`}>Setup script</FieldLabel>
        <Input
          id={`${idPrefix}-setup`}
          value={setupScript}
          onChange={(e) => onSetupScriptChange(e.target.value)}
          placeholder="npm install"
          className="font-mono"
        />
        <FieldDescription>Runs once when a workspace is created</FieldDescription>
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
        <FieldDescription>Starts the dev server for each frame</FieldDescription>
      </Field>

      {/* On the desktop build the configured port is a logical key only —
          portless assigns and delivers the real port (ADR 0010) — so there
          is nothing for the user to set. Hosted keeps the field: there the
          dev server must bind this exact port. */}
      {!isLocalBuild && (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-port`}>Dev server port</FieldLabel>
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

      {isLocalBuild ? (
        // Desktop mode: instead of spelling env vars out, glob patterns of
        // files (e.g. `.env*`) carried over from the original checkout into
        // each workspace's worktree.
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
      )}

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
    </FieldGroup>
  )
}
