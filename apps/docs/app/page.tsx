import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import { DesignerHero } from "@/components/marketing/designers/hero"
import { DesignerFeatures } from "@/components/marketing/designers/features"
import { KnobsDeepDive } from "@/components/marketing/designers/knobs-deep-dive"
import { StateDeepDive } from "@/components/marketing/designers/state-deep-dive"
import { DesignerWorkflow } from "@/components/marketing/designers/workflow"
import { DesignerCTA } from "@/components/marketing/designers/cta"

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <DesignerHero />
        <DesignerFeatures />
        <KnobsDeepDive />
        <StateDeepDive />
        <DesignerWorkflow />
        <DesignerCTA />
      </main>
      <Footer />
    </div>
  )
}
