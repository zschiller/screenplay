import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import { MinimalHero } from "@/components/marketing/minimal/hero"
import { MinimalProblems } from "@/components/marketing/minimal/problems"
import { MinimalWorkflow } from "@/components/marketing/minimal/workflow"
import { MinimalCTA } from "@/components/marketing/minimal/cta"

export default function HomePage() {
  return (
    <div className="brutalist flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <MinimalHero />
        <MinimalProblems />
        <MinimalWorkflow />
        <MinimalCTA />
      </main>
      <Footer />
    </div>
  )
}
