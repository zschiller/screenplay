import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { LocalSetupGate } from "@/components/local-setup/local-setup-gate"
import { getLocalSetupGateStatus } from "@/lib/local-setup/gate-status"
import { githubSkippedForNow } from "@/lib/local-setup/github-skip"
import { isLocalSetupComplete } from "@/lib/local-setup/is-complete"
import { isLocalBuild } from "@/lib/local-mode"

export const metadata: Metadata = {
  title: {
    default: "Screenplay",
    template: "%s · Screenplay",
  },
  description:
    "Design UI on an infinite canvas. Each iframeLayer runs a live sandbox. Collaborate in real time.",
}

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

/**
 * Compute the desktop first-run gate's initial block state **server-side** so the
 * root layout's first paint is already correct — no modal-over-app flash in
 * either direction (the `home-view-prefs` anti-flash pattern). Reads the same
 * live status the poll does and folds it through the shared release predicate.
 * Only ever called on the `isLocalBuild` branch below, so the hosted build never
 * probes host state here.
 */
async function computeInitiallyBlocked(): Promise<boolean> {
  const status = await getLocalSetupGateStatus()
  return !isLocalSetupComplete({
    ...status,
    githubSkipped: githubSkippedForNow,
  })
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The gate covers both real desktop entry points (home surface and a direct
  // canvas load) from this one mount site. On the hosted build `isLocalBuild` is
  // a compile-time `false`, so this branch — and the gate plus its status
  // probes — is dead-code-eliminated and the sign-in path is untouched.
  const body = isLocalBuild ? (
    <LocalSetupGate initiallyBlocked={await computeInitiallyBlocked()}>
      {children}
    </LocalSetupGate>
  ) : (
    children
  )

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>
          {body}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
