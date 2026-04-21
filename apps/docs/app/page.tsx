import { Button } from "@workspace/ui/components/button"

const appUrl =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://build.screenplay.space"

export default function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-10 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Screenplay
      </h1>
      <p className="max-w-xl text-balance text-muted-foreground">
        Build, collaborate, and ship multi-agent coding experiences — together
        on a shared canvas.
      </p>
      <Button size="lg" asChild>
        <a href={appUrl}>Get started</a>
      </Button>
    </main>
  )
}
