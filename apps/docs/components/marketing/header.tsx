import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { githubUrl } from "@/lib/app-url"
import { Wordmark } from "./wordmark"

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1">
          <a href={githubUrl} target="_blank" rel="noreferrer">
            <Button size="sm">GitHub</Button>
          </a>
        </nav>
      </div>
    </header>
  )
}
