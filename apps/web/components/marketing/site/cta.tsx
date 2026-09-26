import { Apple } from "lucide-react"
import { docsUrl, releasesUrl } from "@/lib/app-url"
import { Mascot, type MascotTone } from "./mascot"

const cast: { tone: MascotTone; name: string }[] = [
  { tone: "coral", name: "take-1" },
  { tone: "sun", name: "take-2" },
  { tone: "blue", name: "main" },
  { tone: "mint", name: "take-3" },
  { tone: "lilac", name: "take-4" },
]

export function CTA() {
  return (
    <section className="px-3 pb-24 sm:px-8 sm:pb-32">
      <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-[28px] bg-[#0A1630] px-6 py-20 text-center text-white sm:py-28">
        <div
          className="cta-glow pointer-events-none absolute inset-0"
          aria-hidden
        />
        <div
          className="clapper pointer-events-none absolute inset-x-0 top-0 h-3"
          aria-hidden
        />
        <div className="relative flex flex-col items-center">
          <div
            className="flex items-end gap-3 sm:gap-5"
            aria-label="The Screenplay cast"
          >
            {cast.map((c, i) => (
              <div
                key={c.name}
                className="cast-bob flex flex-col items-center gap-2"
                style={{ animationDelay: `${i * -0.35}s` }}
              >
                <Mascot size={c.tone === "blue" ? 76 : 52} tone={c.tone} />
                <span className="font-screenplay text-[10px] tracking-wide text-white/40 uppercase max-sm:hidden">
                  {c.name}
                </span>
              </div>
            ))}
          </div>
          <h2 className="mt-10 text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
            Quiet on set. Roll camera.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-balance text-white/60 sm:text-lg">
            Download Screenplay, point it at a repo, and ask for three takes of
            anything. See them all at once.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#0A1630] transition-transform hover:-translate-y-0.5"
            >
              <Apple className="size-[18px] fill-current" strokeWidth={0} />
              Download for Mac
            </a>
            <a
              href={docsUrl}
              className="flex h-12 items-center rounded-full border border-white/15 px-6 text-[15px] font-medium text-white/90 transition-colors hover:bg-white/10"
            >
              Read the docs
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
