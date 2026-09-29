import type { Metadata } from "next"
import { Instrument_Serif } from "next/font/google"
import { Footer, Layout, Navbar } from "nextra-theme-docs"
import { Head } from "nextra/components"
import { getPageMap } from "nextra/page-map"
import "nextra-theme-docs/style.css"
import "./globals.css"
import { ScreenplayMark } from "@workspace/ui/components/screenplay-mark"

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400" })

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
          <span style={{ opacity: 0.55 }}>Docs</span>
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
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
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
