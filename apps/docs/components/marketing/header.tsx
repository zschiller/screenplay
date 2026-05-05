import Link from "next/link"
import { githubUrl } from "@/lib/app-url"
import { Wordmark } from "./wordmark"

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="#how"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            How
          </Link>
          <Link
            href="#packages"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Packages
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub ↗
          </a>
        </nav>
      </div>
    </header>
  )
}
