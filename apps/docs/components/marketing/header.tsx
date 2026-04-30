import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { appUrl, githubUrl } from "@/lib/app-url"
import { Wordmark } from "./wordmark"

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1">
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-block"
          >
            GitHub
          </a>
          <a href={appUrl}>
            <Button size="sm">Open Screenplay</Button>
          </a>
        </nav>
      </div>
    </header>
  )
}
