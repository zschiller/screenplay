"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@workspace/ui/components/confirmation"
import { CheckIcon } from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { SkillDialog } from "@/components/skills/saved-skill-list"
import { bareToolName } from "@/lib/agent/tool-name"
import type { AgentMessage } from "@/lib/agent/types"
import { parseFrontmatter } from "@/lib/skills/frontmatter"
import {
  offeredSkillState,
  saveOfferedSkill,
  type OfferedSkill,
  type SkillSaveScope,
} from "@/lib/skills/actions"
import type { OpenedSkill, SkillFile } from "@/lib/skills/saved"
import { InlineRef } from "./inline-ref"
import { useViewing } from "@/lib/viewer/context"

type ToolCallMessage = AgentMessage & { role: "tool_call" }

export function isSaveSkillCall(message: AgentMessage): boolean {
  return (
    message.role === "tool_call" && bareToolName(message.title) === "save_skill"
  )
}

/** A `save_skill` call's arguments, or null while they stream or don't fit. */
export function parseOfferedSkill(
  input: unknown
): (OfferedSkill & { scope?: SkillSaveScope }) | null {
  if (!input || typeof input !== "object") return null
  const { name, content, files, scope } = input as Record<string, unknown>
  if (typeof name !== "string" || typeof content !== "string") return null
  const fileList = Array.isArray(files)
    ? files.filter(
        (f): f is SkillFile =>
          !!f &&
          typeof (f as SkillFile).path === "string" &&
          typeof (f as SkillFile).content === "string"
      )
    : undefined
  return {
    name,
    content,
    files: fileList,
    scope: scope === "account" || scope === "canvas" ? scope : undefined,
  }
}

const SCOPE_LABEL: Record<SkillSaveScope, string> = {
  account: "Save to account",
  canvas: "Save to canvas",
}

const REPLACED_NOUN: Record<SkillSaveScope, string> = {
  account: "your account skill",
  canvas: "the canvas skill",
}

/**
 * What a save would replace: the skills of that name already saved, else the
 * Built in one (which a saved one already takes the place of).
 */
function replacesLine(
  replaces: readonly SkillSaveScope[],
  builtIn: boolean
): string | null {
  if (replaces.length > 0) {
    return `Replaces ${replaces.map((s) => REPLACED_NOUN[s]).join(" and ")}`
  }
  return builtIn ? "Replaces the Built in skill" : null
}

const SAVED_LABEL: Record<SkillSaveScope, string> = {
  account: "Saved to your account",
  canvas: "Saved to this canvas",
}

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | {
      kind: "ready"
      savedTo: SkillSaveScope | null
      replaces: SkillSaveScope[]
      replacesBuiltIn: boolean
    }

/**
 * The card a chat shows for a Skill its agent offered with `save_skill`
 * (#1633): the Skill's name and description, what it would replace (a
 * canvas or account Skill of that name, or a Built in one), and Save to
 * account and Save to canvas, as a Confirmation; the name opens the whole
 * Skill. Nothing is saved until someone presses Save; the agent's suggested
 * scope is the primary button.
 * Once saved, the card says where, for everyone and after a reload, since it
 * asks the server whether that scope holds this Skill as offered.
 *
 * Renders `fallback` (the plain tool row) while the call runs, when it
 * failed, and when its Skill doesn't validate.
 */
export function SkillSaveCard({
  message,
  roomId,
  fallback,
}: {
  message: ToolCallMessage
  roomId: string
  fallback: ReactNode
}) {
  const offered = useMemo(
    () => parseOfferedSkill(message.rawInput),
    [message.rawInput]
  )
  const done = message.status === "completed"
  const [state, setState] = useState<State>({ kind: "loading" })
  const [saving, setSaving] = useState<SkillSaveScope | null>(null)
  // Only the host acts on it; a viewer (#1933) reads it.
  const watching = !!useViewing()
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const key = offered ? JSON.stringify(offered) : null

  useEffect(() => {
    if (!done || !key) return
    let cancelled = false
    offeredSkillState(roomId, JSON.parse(key) as OfferedSkill).then(
      (result) => {
        if (cancelled) return
        setState(result.ok ? { kind: "ready", ...result } : { kind: "invalid" })
      },
      (err) => {
        console.error("Failed to check offered skill", err)
        if (!cancelled) setState({ kind: "invalid" })
      }
    )
    return () => {
      cancelled = true
    }
  }, [done, key, roomId])

  const readSkill = useCallback(
    async (): Promise<OpenedSkill> => ({
      content: offered?.content ?? "",
      files: offered?.files ?? [],
    }),
    [offered]
  )

  if (!offered || !done || state.kind === "invalid") return <>{fallback}</>

  let description = ""
  try {
    description = parseFrontmatter(offered.content, "").metadata.description
  } catch {
    // Validated on the server; a card that got here has frontmatter.
  }

  const save = async (scope: SkillSaveScope) => {
    setSaving(scope)
    setError(null)
    try {
      await saveOfferedSkill(roomId, scope, offered)
      setState((s) => (s.kind === "ready" ? { ...s, savedTo: scope } : s))
    } catch (err) {
      console.error("Failed to save skill", err)
      setError("Couldn’t save this skill. Try again.")
    } finally {
      setSaving(null)
    }
  }

  const suggested = offered.scope ?? "canvas"
  const scopes: SkillSaveScope[] =
    suggested === "account" ? ["account", "canvas"] : ["canvas", "account"]
  const savedTo = state.kind === "ready" ? state.savedTo : null
  const replaces =
    state.kind === "ready"
      ? replacesLine(savedTo ? [] : state.replaces, state.replacesBuiltIn)
      : null

  return (
    <>
      <Confirmation
        data-testid="skill-save-card"
        state={savedTo ? "accepted" : "requested"}
      >
        <ConfirmationTitle>
          <ConfirmationRequest>
            <span className="flex flex-col gap-0.5">
              <span>
                Save the{" "}
                <InlineRef kind="skill" onClick={() => setViewing(true)}>
                  {offered.name}
                </InlineRef>{" "}
                skill?
              </span>
              {description && (
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {description}
                </span>
              )}
              {replaces && (
                <span className="text-sm text-muted-foreground">
                  {replaces}
                </span>
              )}
            </span>
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <span
              data-testid="card-outcome"
              className="flex items-center gap-1.5"
            >
              <CheckIcon aria-hidden className="size-4" />
              <span>
                <InlineRef kind="skill" onClick={() => setViewing(true)}>
                  {offered.name}
                </InlineRef>{" "}
                {savedTo ? SAVED_LABEL[savedTo].toLowerCase() : ""}
              </span>
            </span>
          </ConfirmationAccepted>
        </ConfirmationTitle>
        {error && (
          <p role="alert" className="text-sm text-muted-foreground">
            {error}
          </p>
        )}
        {!watching && (
          <ConfirmationActions>
            {state.kind === "loading" ? (
              <Spinner className="size-4" aria-label="Checking skill…" />
            ) : (
              [...scopes].reverse().map((scope, i) => (
                <ConfirmationAction
                  key={scope}
                  variant={i === scopes.length - 1 ? "default" : "outline"}
                  disabled={saving !== null}
                  onClick={() => save(scope)}
                >
                  {saving === scope && <Spinner />}
                  {SCOPE_LABEL[scope]}
                </ConfirmationAction>
              ))
            )}
          </ConfirmationActions>
        )}
      </Confirmation>
      <SkillDialog
        skill={
          viewing
            ? {
                name: offered.name,
                description,
                addedBy: "agent",
                addedById: "",
                createdAt: 0,
                updatedAt: 0,
              }
            : null
        }
        readSkill={readSkill}
        onOpenChange={(open) => {
          if (!open) setViewing(false)
        }}
      />
    </>
  )
}
