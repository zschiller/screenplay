import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Geist_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google"

import "./globals.css"
import { MotionProvider } from "@/components/motion-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"
import { LocalSetupGate } from "@/components/local-setup/local-setup-gate"
import { getLocalSetupGateStatus } from "@/lib/local-setup/gate-status"
import {
  githubSkipCookieName,
  parseGitHubSkip,
} from "@/lib/local-setup/github-skip"
import { isLocalSetupComplete } from "@/lib/local-setup/is-complete"
import { isLocalBuild } from "@/lib/local-mode"

export const metadata: Metadata = {
  title: {
    default: "Screenplay",
    template: "%s · Screenplay",
  },
  description:
    "Design UI on an infinite canvas. Each frame is a live preview of your app. Collaborate in real time.",
}

// The app's type voice (#1005): Instrument Sans for the UI, Instrument Serif
// (one weight) for page, dialog and empty-state titles, Geist Mono for code and
// section labels. `next/font` downloads them at build time and serves them from
// the app, so the desktop build works offline. `globals.css` maps these
// variables onto `font-sans` and `font-heading`.
const fontSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
})

const fontSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

/**
 * Compute the desktop first-run gate's initial block state **server-side** so the
 * root layout's first paint is already correct — no modal-over-app flash in
 * either direction (the `home-view-prefs` anti-flash pattern). Reads the same
 * live status the poll does, folds in the persisted GitHub-skip bit (so a
 * skipped, harness-satisfied user is never re-blocked), and runs it all through
 * the shared release predicate. Only ever called on the `isLocalBuild` branch
 * below, so the hosted build never probes host state here.
 */
async function computeGateState(): Promise<{
  initiallyBlocked: boolean
  status: { harnessSatisfied: boolean; githubSatisfied: boolean }
  githubSkipped: boolean
}> {
  const cookieStore = await cookies()
  const githubSkipped = parseGitHubSkip(
    cookieStore.get(githubSkipCookieName())?.value
  )
  const status = await getLocalSetupGateStatus()
  return {
    githubSkipped,
    status,
    initiallyBlocked: !isLocalSetupComplete({ ...status, githubSkipped }),
  }
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
  let body: React.ReactNode = children
  if (isLocalBuild) {
    const { initiallyBlocked, status, githubSkipped } = await computeGateState()
    body = (
      <LocalSetupGate
        initiallyBlocked={initiallyBlocked}
        initialStatus={status}
        initiallyGithubSkipped={githubSkipped}
      >
        {children}
      </LocalSetupGate>
    )
  }

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        fontSerif.variable,
        "font-sans",
        fontSans.variable
      )}
    >
      <body>
        <ThemeProvider>
          <MotionProvider>
            {body}
            {/* Top center, clear of the chat composer and the canvas tool
                pill along the bottom (#1029). */}
            <Toaster position="top-center" />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
