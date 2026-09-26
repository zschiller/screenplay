import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import { Hero } from "@/components/marketing/site/hero"
import { AgentsStrip } from "@/components/marketing/site/agents-strip"
import { Problem } from "@/components/marketing/site/problem"
import { Scenes } from "@/components/marketing/site/scenes"
import { Features } from "@/components/marketing/site/features"
import { OpenSource } from "@/components/marketing/site/open-source"
import { Faq } from "@/components/marketing/site/faq"
import { CTA } from "@/components/marketing/site/cta"

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <AgentsStrip />
        <Problem />
        <Scenes />
        <Features />
        <OpenSource />
        <Faq />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
