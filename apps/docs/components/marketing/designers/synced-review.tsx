"use client"

import { useState } from "react"
import { useSharedState } from "@screenplay.space/state"

const STEPS = ["Cart", "Ship", "Pay", "Done"]

export function SyncedReview() {
  const [activeStep, setActiveStep] = useState(0)
  useSharedState("checkout-step", activeStep, setActiveStep)

  const isDone = activeStep >= STEPS.length - 1

  return (
    <div className="space-y-2">
      <ClientWindow
        user={{ initials: "M", name: "maya · designer", color: "#106BE3" }}
        activeStep={activeStep}
        showCursor
        onAdvance={() =>
          setActiveStep((s) => (s < STEPS.length - 1 ? s + 1 : 0))
        }
        isDone={isDone}
      />

      {/* Sync connector */}
      <div className="flex items-center gap-3 px-2">
        <div className="h-px flex-1 bg-border" />
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 shadow-sm">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#106BE3] opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#106BE3]" />
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            state synced
          </span>
        </div>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ClientWindow
          user={{ initials: "J", name: "jules · pm", color: "#E0457B" }}
          activeStep={activeStep}
        />
        <ClientWindow
          user={{ initials: "S", name: "sam · eng", color: "#10B981" }}
          activeStep={activeStep}
        />
      </div>
    </div>
  )
}

function ClientWindow({
  user,
  activeStep,
  showCursor,
  onAdvance,
  isDone,
}: {
  user: { initials: string; name: string; color: string }
  activeStep: number
  showCursor?: boolean
  onAdvance?: () => void
  isDone?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <div className="mx-2 flex-1 rounded bg-background/60 px-2 py-0.5 text-[9px] text-muted-foreground/50">
          acme.com/checkout
        </div>
        <span
          className="flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
          style={{ backgroundColor: user.color }}
        >
          {user.initials}
        </span>
        <span className="text-[9px] text-muted-foreground">{user.name}</span>
      </div>

      {/* Checkout content */}
      <div className="p-3">
        {/* Step progress */}
        <div className="mb-3 flex items-center justify-between">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <div className="flex items-center gap-1">
                <span
                  className={`flex size-3.5 items-center justify-center rounded-full text-[8px] font-semibold transition-colors duration-300 ${
                    i < activeStep
                      ? "bg-[#106BE3] text-white"
                      : i === activeStep
                        ? "border border-[#106BE3] text-[#106BE3]"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < activeStep ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[9px] transition-colors duration-300 ${i <= activeStep ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`h-px w-3 transition-colors duration-300 ${i < activeStep ? "bg-[#106BE3]" : "bg-border"}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <StepContent
          activeStep={activeStep}
          showCursor={showCursor}
          onAdvance={onAdvance}
          isDone={isDone}
        />
      </div>
    </div>
  )
}

function StepContent({
  activeStep,
  showCursor,
  onAdvance,
  isDone,
}: {
  activeStep: number
  showCursor?: boolean
  onAdvance?: () => void
  isDone?: boolean
}) {
  if (activeStep === 0) {
    // Cart step
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          {[
            { name: "Wireless Headphones", price: "$89.00" },
            { name: "USB-C Cable", price: "$12.00" },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5"
            >
              <span className="text-[10px] text-foreground/70">{item.name}</span>
              <span className="text-[10px] font-medium">{item.price}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] text-muted-foreground">Total</span>
          <span className="text-[10px] font-semibold">$101.00</span>
        </div>
        {showCursor && onAdvance ? (
          <button
            onClick={onAdvance}
            className="w-full rounded-md bg-[#106BE3] py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Continue to Shipping →
          </button>
        ) : (
          <div className="w-full rounded-md bg-[#106BE3]/30 py-1.5 text-center text-[10px] font-semibold text-[#106BE3]/60">
            Continue to Shipping →
          </div>
        )}
      </div>
    )
  }

  if (activeStep === 1) {
    // Shipping step
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground">Address</p>
          <div
            className={`rounded-md border bg-background px-2 py-1.5 ${
              showCursor
                ? "border-[#106BE3] ring-1 ring-[#106BE3]/30"
                : "border-border"
            }`}
          >
            <span className="text-[10px] text-foreground/70">
              123 Main St, San Francisco
            </span>
            {showCursor && (
              <span className="ml-1 inline-block h-2.5 w-px animate-pulse bg-[#106BE3]" />
            )}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground">Method</p>
          <div className="flex gap-1.5">
            {["Standard", "Express"].map((method, i) => (
              <div
                key={method}
                className={`flex-1 rounded-md border px-2 py-1.5 text-center text-[9px] ${
                  i === 0
                    ? "border-[#106BE3] bg-[#106BE3]/5 text-[#106BE3]"
                    : "border-border text-muted-foreground"
                }`}
              >
                {method}
              </div>
            ))}
          </div>
        </div>
        {showCursor && onAdvance ? (
          <button
            onClick={onAdvance}
            className="w-full rounded-md bg-[#106BE3] py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Continue to Payment →
          </button>
        ) : (
          <div className="w-full rounded-md bg-[#106BE3]/30 py-1.5 text-center text-[10px] font-semibold text-[#106BE3]/60">
            Continue to Payment →
          </div>
        )}
      </div>
    )
  }

  if (activeStep === 2) {
    // Payment step
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground">Card number</p>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
            <span className="text-[10px] tracking-widest text-foreground/70">
              •••• 4242
            </span>
            <span className="ml-auto rounded bg-muted px-1 text-[8px] text-muted-foreground">
              VISA
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <p className="text-[9px] text-muted-foreground">Expiry</p>
            <div className="rounded-md border border-border bg-background px-2 py-1.5 text-[10px] text-foreground/70">
              08 / 26
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] text-muted-foreground">CVC</p>
            <div
              className={`flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 ${
                showCursor
                  ? "border-[#106BE3] ring-1 ring-[#106BE3]/30"
                  : "border-border"
              }`}
            >
              <span className="text-[10px] text-foreground/70">•••</span>
              {showCursor && (
                <span className="ml-auto h-2.5 w-px animate-pulse bg-[#106BE3]" />
              )}
            </div>
          </div>
        </div>
        {showCursor && onAdvance ? (
          <button
            onClick={onAdvance}
            className="w-full rounded-md bg-[#106BE3] py-1.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Pay $128.00
          </button>
        ) : (
          <div className="w-full rounded-md bg-[#106BE3]/30 py-1.5 text-center text-[10px] font-semibold text-[#106BE3]/60">
            Pay $128.00
          </div>
        )}
      </div>
    )
  }

  // Done step
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-3">
      <div className="flex size-8 items-center justify-center rounded-full bg-[#10B981]/15 text-lg">
        ✓
      </div>
      <p className="text-[10px] font-semibold text-foreground">Order placed!</p>
      <p className="text-center text-[9px] text-muted-foreground">
        Confirmation sent to hello@acme.com
      </p>
      {showCursor && onAdvance && (
        <button
          onClick={onAdvance}
          className="mt-1 rounded-md border border-border px-3 py-1 text-[9px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ↺ Start over
        </button>
      )}
    </div>
  )
}
