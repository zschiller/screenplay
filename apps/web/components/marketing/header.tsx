import Link from "next/link"
import { githubUrl } from "@/lib/app-url"
import { Wordmark } from "./wordmark"

export function Header() {
  return (
    <header className="brutal-border-b sticky top-0 z-50 bg-[var(--brutal-paper)]">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.12em] sm:gap-3">
          <Link
            href="#how"
            className="brutal-border-2 px-3 py-1.5 transition-colors hover:bg-[var(--brutal-yellow)]"
          >
            How
          </Link>
          <Link
            href="#packages"
            className="brutal-border-2 px-3 py-1.5 transition-colors hover:bg-[var(--brutal-yellow)]"
          >
            Packages
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="brutal-border-2 bg-[var(--brutal-blue)] px-3 py-1.5 text-white transition-colors hover:bg-[var(--brutal-ink)]"
          >
            GitHub ↗
          </a>
        </nav>
      </div>
    </header>
  )
}
