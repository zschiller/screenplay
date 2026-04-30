import type { Metadata } from "next"
import { Header } from "@/components/marketing/header"
import { Footer } from "@/components/marketing/footer"
import { DesignerHero } from "@/components/marketing/designers/hero"
import { DesignerFeatures } from "@/components/marketing/designers/features"
import { KnobsDeepDive } from "@/components/marketing/designers/knobs-deep-dive"
import { StateDeepDive } from "@/components/marketing/designers/state-deep-dive"
import { DesignerWorkflow } from "@/components/marketing/designers/workflow"
import { DesignerCTA } from "@/components/marketing/designers/cta"

export const metadata: Metadata = {
  title: "Screenplay for designers — a visual canvas for code prototypes",
  description:
    "Screenplay is the collaboration layer for designers who prototype in code. Drop routes on an infinite canvas, expose live knobs, sync state across viewers, and share a link your team can click.",
}

export default function DesignersPage() {
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
