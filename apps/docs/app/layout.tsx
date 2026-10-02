import type { Metadata } from "next"
import { Geist_Mono, Instrument_Sans, Unbounded } from "next/font/google"
import { Footer, Layout, Navbar } from "nextra-theme-docs"
import { Head } from "nextra/components"
import { getPageMap } from "nextra/page-map"
import "nextra-theme-docs/style.css"
// Tailwind utilities and the app tokens for shared components (no preflight:
// Nextra brings its own).
import "@workspace/ui/embed.css"
import "./globals.css"
import { ScreenplayMark } from "@workspace/ui/components/screenplay-mark"
import { ANSI_PALETTE_CSS } from "@workspace/ui/lib/ansi-palette"

// The type voice the app uses (#1005, #1077): Instrument Sans for the text,
// Unbounded for headings, Geist Mono for code and the sidebar's section
// labels, and Unbounded 600 for the wordmark. `globals.css` maps these
// variables onto Nextra's fonts.
const sans = Instrument_Sans({
  subsets: ["latin"],
  // Real italics for *emphasis*, instead of the browser slanting the upright.
  style: ["normal", "italic"],
  variable: "--font-instrument-sans",
})
const heading = Unbounded({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-unbounded",
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
          <span
            className={heading.className}
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.03em" }}
          >
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
      className={`${sans.variable} ${heading.variable} ${mono.variable}`}
    >
      {/* Magenta (hue 326) for links and the current page, on pure white and black. */}
      <Head
        color={{
          hue: 326,
          saturation: 100,
          lightness: { light: 45, dark: 62 },
        }}
        backgroundColor={{ light: "#ffffff", dark: "#000000" }}
      >
        {/* The terminal's ANSI palette as `--ansi-*`, which code blocks read. */}
        <style>{ANSI_PALETTE_CSS}</style>
      </Head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/zschiller/screenplay/tree/main/apps/docs"
          footer={footer}
          toc={{ title: "On this page" }}
          // components/copy-page.tsx renders it as the app's split button.
          copyPageButton={false}
          // components/page-nav.tsx renders previous / next as buttons.
          navigation={false}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
