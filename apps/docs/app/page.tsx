import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import { MinimalHero } from "@/components/marketing/minimal/hero"
import { MinimalProblems } from "@/components/marketing/minimal/problems"
import { MinimalPackages } from "@/components/marketing/minimal/packages"
import { MinimalWorkflow } from "@/components/marketing/minimal/workflow"
import { MinimalCTA } from "@/components/marketing/minimal/cta"

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <MinimalHero />
        <MinimalProblems />
        <MinimalWorkflow />
        <MinimalPackages />
        <MinimalCTA />
      </main>
      <Footer />
    </div>
  )
}
