import type { Metadata } from "next"
import { Courier_Prime, Geist, Geist_Mono } from "next/font/google"

import "@workspace/ui/globals.css"
import "./marketing.css"
import { cn } from "@workspace/ui/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontScreenplay = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-screenplay",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Screenplay — every take, running at once",
  description:
    "Screenplay gives each coding agent its own branch, its own sandbox, and a frame on a shared canvas. Ask for three directions, click through all three live, and ship the one that works. Works with Claude Code, Codex and opencode.",
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
        fontScreenplay.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
