import type { Metadata } from "next"
import {
  Geist_Mono,
  Instrument_Sans,
  Instrument_Serif,
  Unbounded,
} from "next/font/google"

import "./marketing.css"
import { cn } from "@workspace/ui/lib/utils"

// The Editorial type voice (#1005, #1010), with the app's titles (#1077):
// Instrument Sans for text, Unbounded for headlines, Geist Mono for small
// uppercase labels. `marketing.css` maps these onto `font-sans` and
// `font-heading`. Instrument Serif (with its italic) stays for the wordmark
// and the hero headline.
const fontSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
})

const fontSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
})

const fontHeading = Unbounded({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-unbounded",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  // The link preview (P14): app/opengraph-image.jpg, captured from app/og by
  // `pnpm og-image`. X, Slack and iMessage read these tags.
  openGraph: { siteName: "Screenplay", type: "website" },
  twitter: { card: "summary_large_image" },
  title: "Screenplay — every branch, side by side",
  description:
    "Screenplay runs each coding agent on its own branch, in its own sandbox, and shows every result as a live frame on one canvas. Compare them side by side and ship the one that works. Works with Claude Code, Codex and opencode.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      // The marketing site is always dark, whatever the system theme. Docs
      // and the app still follow the system.
      className={cn(
        "dark",
        "antialiased",
        fontMono.variable,
        fontSerif.variable,
        fontHeading.variable,
        "font-sans",
        fontSans.variable
      )}
    >
      <body>{children}</body>
    </html>
  )
}
