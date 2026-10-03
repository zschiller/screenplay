import Link from "next/link"

import { docsUrl, downloadUrl, githubUrl } from "@/lib/app-url"
import { cn } from "@workspace/ui/lib/utils"

import { buttonClass, focusRing, measure } from "./site/editorial"
import { HeaderBar } from "./header-bar"
import { Wordmark } from "./wordmark"

const links = [
  { href: "#how", label: "How it works" },
  { href: "#self-hosting", label: "For teams" },
  { href: "#features", label: "Features" },
  { href: docsUrl, label: "Docs" },
]

export function Header() {
  return (
    <HeaderBar>
      <div
        className={`${measure} grid h-15 grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr]`}
      >
        <Link
          href="/"
          aria-label="Screenplay home"
          className={cn(focusRing, "justify-self-start")}
        >
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 text-[14.5px] md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                focusRing,
                "text-muted-foreground transition-colors hover:text-foreground"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-4 text-[14.5px] sm:gap-5">
          {/* Docs sits in the nav from md up; below that it joins GitHub here,
              and the narrowest phones keep only the wordmark and Download. */}
          <Link
            href={docsUrl}
            className={cn(
              focusRing,
              "text-muted-foreground transition-colors hover:text-foreground max-[359px]:hidden md:hidden"
            )}
          >
            Docs
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            // Muted like the nav, so Download is the one filled action.
            className={cn(
              focusRing,
              "text-muted-foreground transition-colors hover:text-foreground max-[419px]:hidden"
            )}
          >
            GitHub
          </a>
          <a href={downloadUrl} className={buttonClass("solid")}>
            Download
          </a>
        </div>
      </div>
    </HeaderBar>
  )
}

export function AppleLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  )
}
