"use client"

import type { ReactNode } from "react"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
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

function SectionCaption({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  )
}

function FieldDescription({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground/70">{children}</p>
}

/**
 * The shared run-settings body for a repo: the six fields that mean the same
 * thing on the homepage preset form and the canvas room-sidebar settings
 * dialog, grouped into Run / Environment / Defaults sections.
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SectionCaption>Run</SectionCaption>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-setup`}>Setup script</Label>
          <Input
            id={`${idPrefix}-setup`}
            value={setupScript}
            onChange={(e) => onSetupScriptChange(e.target.value)}
            placeholder="npm install"
            className="font-mono"
          />
          <FieldDescription>
            Runs once when a workspace is created.
          </FieldDescription>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-dev`}>Dev script</Label>
          <Input
            id={`${idPrefix}-dev`}
            value={devScript}
            onChange={(e) => onDevScriptChange(e.target.value)}
            placeholder="npm run dev"
            className="font-mono"
          />
          <FieldDescription>
            Starts the dev server previewed in each frame.
          </FieldDescription>
        </div>

        {/* On the desktop build the configured port is a logical key only —
            portless assigns and delivers the real port (ADR 0010) — so there
            is nothing for the user to set. Hosted keeps the field: there the
            dev server must bind this exact port. */}
        {!isLocalBuild && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-port`}>Dev server port</Label>
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
              The port your dev server binds to (1–65535).
            </FieldDescription>
          </div>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SectionCaption>Environment</SectionCaption>

        {isLocalBuild ? (
          // Desktop mode: instead of spelling env vars out, glob patterns of
          // files (e.g. `.env*`) carried over from the original checkout into
          // each workspace's worktree.
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-copy-patterns`}>
              Files to copy into workspaces
            </Label>
            <Textarea
              id={`${idPrefix}-copy-patterns`}
              value={copyPatterns}
              onChange={(e) => onCopyPatternsChange(e.target.value)}
              placeholder={".env*\napps/*/.env*"}
              rows={3}
              className="[field-sizing:fixed] max-w-full resize-y font-mono text-xs"
            />
            <FieldDescription>
              Glob patterns from your checkout, one per line.
            </FieldDescription>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-envvars`}>Environment variables</Label>
            <Textarea
              id={`${idPrefix}-envvars`}
              value={envVars}
              onChange={(e) => onEnvVarsChange(e.target.value)}
              placeholder={"KEY=value\nANOTHER_KEY=value"}
              rows={4}
              className="[field-sizing:fixed] max-w-full resize-y font-mono text-xs"
            />
            <FieldDescription>
              One KEY=value per line, injected into the workspace.
            </FieldDescription>
          </div>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SectionCaption>Defaults</SectionCaption>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-default-frame-size`}>
            Default frame size
          </Label>
          <IframeLayerSizeSelect
            id={`${idPrefix}-default-frame-size`}
            value={defaultIframeLayerSizeId}
            onChange={onDefaultIframeLayerSizeIdChange}
          />
          <FieldDescription>
            The viewport size new frames open at.
          </FieldDescription>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-system-prompt`}>System prompt</Label>
          <Textarea
            id={`${idPrefix}-system-prompt`}
            value={systemPrompt}
            onChange={(e) => onSystemPromptChange(e.target.value)}
            placeholder="This config targets the Next.js app under apps/web. Treat apps/web as the project root."
            rows={4}
            className="[field-sizing:fixed] max-w-full resize-y text-xs"
          />
          <FieldDescription>
            Optional, appended to the agent&apos;s instructions — useful for
            monorepo context.
          </FieldDescription>
        </div>
      </div>
    </div>
  )
}
