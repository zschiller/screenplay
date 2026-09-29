import type { Metadata } from "next"
import { Geist_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google"

import "./marketing.css"
import { cn } from "@workspace/ui/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"

// The Editorial type voice (#1005, #1010): Instrument Sans for text,
// Instrument Serif (with its italic, for the hero's selected word) for
// headlines, Geist Mono for small uppercase labels. `marketing.css` maps these
// onto `font-sans` and `font-heading`.
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

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Screenplay — every branch, running at once",
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
