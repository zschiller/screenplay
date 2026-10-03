import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import { Hero } from "@/components/marketing/site/hero"
import { Problem } from "@/components/marketing/site/problem"
import { Scenes } from "@/components/marketing/site/scenes"
import { BeforeYouBuild } from "@/components/marketing/site/before-you-build"
import { Features } from "@/components/marketing/site/features"
import { SelfHosting } from "@/components/marketing/site/self-hosting"
import { Faq } from "@/components/marketing/site/faq"
import { CTA } from "@/components/marketing/site/cta"

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Problem />
        <Scenes />
        <BeforeYouBuild />
        <SelfHosting />
        <Features />
        <Faq />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
