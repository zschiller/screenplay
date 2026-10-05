"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

// AI Elements' Confirmation (the shadcn tool-approval card), built on our
// Alert. Its state is the card's own rather than an AI SDK tool part, since
// our cards outlive the turn: "requested" shows the request and actions,
// "accepted" and "rejected" show what was decided.

type ConfirmationState = "requested" | "accepted" | "rejected"

const ConfirmationContext = React.createContext<ConfirmationState>("requested")

function Confirmation({
  className,
  state,
  ...props
}: Omit<React.ComponentProps<typeof Alert>, "role"> & {
  state: ConfirmationState
}) {
  return (
    <ConfirmationContext.Provider value={state}>
      <Alert
        role="group"
        data-slot="confirmation"
        data-state={state}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </ConfirmationContext.Provider>
  )
}

function ConfirmationTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDescription>) {
  return (
    <AlertDescription
      data-slot="confirmation-title"
      className={cn("inline text-foreground", className)}
      {...props}
    />
  )
}

function Shown({
  when,
  children,
}: {
  when: ConfirmationState
  children?: React.ReactNode
}) {
  return React.useContext(ConfirmationContext) === when ? children : null
}

function ConfirmationRequest({ children }: { children?: React.ReactNode }) {
  return <Shown when="requested">{children}</Shown>
}

function ConfirmationAccepted({ children }: { children?: React.ReactNode }) {
  return <Shown when="accepted">{children}</Shown>
}

function ConfirmationRejected({ children }: { children?: React.ReactNode }) {
  return <Shown when="rejected">{children}</Shown>
}

function ConfirmationActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  if (React.useContext(ConfirmationContext) !== "requested") return null
  return (
    <div
      data-slot="confirmation-actions"
      className={cn("flex items-center justify-end gap-2 self-end", className)}
      {...props}
    />
  )
}

function ConfirmationAction(props: React.ComponentProps<typeof Button>) {
  return <Button size="sm" type="button" {...props} />
}

export {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
}
