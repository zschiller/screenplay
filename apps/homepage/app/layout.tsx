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
// `font-heading`; the logotype is Unbounded at 600. Instrument Serif (with its
// italic) stays for the hero headline.
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
  weight: ["400", "600"],
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
    "Run your coding agents on separate branches and see every result live on one canvas. Free and open source, for Mac.",
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
