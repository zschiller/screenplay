import type { Metadata } from "next"
import { Geist_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google"
import { Footer, Layout, Navbar } from "nextra-theme-docs"
import { Head } from "nextra/components"
import { getPageMap } from "nextra/page-map"
import "nextra-theme-docs/style.css"
import "./globals.css"
import { ScreenplayMark } from "@workspace/ui/components/screenplay-mark"

// The Editorial type voice the app uses (#1005, #1011): Instrument Sans for
// the text, Instrument Serif for page titles and the wordmark, Geist Mono for
// code and the sidebar's section labels. `globals.css` maps these variables
// onto Nextra's fonts.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
})
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
})
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: {
    default: "Screenplay Docs",
    template: "%s – Screenplay Docs",
  },
  description:
    "Screenplay runs coding agents in live dev environments on a shared canvas. Guides for using, building for, and self-hosting it.",
}

const navbar = (
  <Navbar
    logo={
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ScreenplayMark width={24} height={24} />
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className={serif.className} style={{ fontSize: 26 }}>
            Screenplay
          </span>
          <span className="sp-docs-label">Docs</span>
        </span>
      </span>
    }
    projectLink="https://github.com/zschiller/screenplay"
  />
)

const footer = <Footer>MIT {new Date().getFullYear()} © Screenplay.</Footer>

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
    >
      {/* Magenta (hue 326) for links and the current page, on pure white and black. */}
      <Head
        color={{
          hue: 326,
          saturation: 100,
          lightness: { light: 45, dark: 62 },
        }}
        backgroundColor={{ light: "#ffffff", dark: "#000000" }}
      />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/zschiller/screenplay/tree/main/apps/docs"
          footer={footer}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
