import { Header } from "@/components/marketing/header"
import { Hero } from "@/components/marketing/hero"
import { Features } from "@/components/marketing/features"
import { Packages } from "@/components/marketing/packages"
import { HowItWorks } from "@/components/marketing/how-it-works"
import { CTA } from "@/components/marketing/cta"
import { Footer } from "@/components/marketing/footer"

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Features />
        <Packages />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
