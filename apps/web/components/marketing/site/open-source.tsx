import { knobsNpmUrl, stateNpmUrl, githubUrl } from "@/lib/app-url"
import { GitHubIcon } from "../header"
import { SectionHeading } from "./section-heading"

const packages = [
  {
    name: "@screenplay.space/knobs",
    href: knobsNpmUrl,
    pitch: "Live controls for any prototype.",
    code: [
      ["k", "const"],
      ["t", " radius = "],
      ["f", "useKnob"],
      ["t", "({"],
      ["n", "\n  id: "],
      ["s", '"card-radius"'],
      ["n", ",\n  type: "],
      ["s", '"slider"'],
      ["n", ",\n  min: "],
      ["v", "0"],
      ["n", ", max: "],
      ["v", "32"],
      ["n", ", default: "],
      ["v", "12"],
      ["t", ",\n})"],
    ],
  },
  {
    name: "@screenplay.space/state",
    href: stateNpmUrl,
    pitch: "One state, every frame, every viewer.",
    code: [
      ["k", "const"],
      ["t", " [step, setStep] = "],
      ["f", "useState"],
      ["t", "("],
      ["s", '"cart"'],
      ["t", ")\n"],
      ["f", "useSharedState"],
      ["t", "("],
      ["s", '"checkout-step"'],
      ["t", ", step, setStep)"],
    ],
  },
] as const

const tone: Record<string, string> = {
  k: "text-[#C084FC]",
  f: "text-[#6AA8FF]",
  s: "text-[#86EFAC]",
  v: "text-[#FDBA74]",
  t: "text-zinc-300",
  n: "text-zinc-300",
}

export function OpenSource() {
  return (
    <section
      id="open-source"
      className="scroll-mt-20 border-y border-border/60 bg-muted/30"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[0.9fr_1.1fr] lg:items-center [&>*]:min-w-0">
        <div>
          <SectionHeading
            slug="Credits"
            title="Open source, down to the props."
            body="Screenplay is MIT licensed. Run the desktop app, self-host the multiplayer web app, or swap in your own sandbox, blob store and models. The two packages that make prototypes tweakable are on npm."
          />
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <GitHubIcon /> zschiller/screenplay
          </a>
        </div>
        <div className="flex flex-col gap-4">
          {packages.map((p) => (
            <a
              key={p.name}
              href={p.href}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-2xl border border-border bg-[#0D0F14] shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <span className="font-mono text-[13px] text-white">
                  {p.name}
                </span>
                <span className="text-xs text-zinc-500 transition-colors group-hover:text-zinc-300 max-sm:hidden">
                  {p.pitch} ↗
                </span>
              </div>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed">
                <code>
                  {p.code.map(([t, s], i) => (
                    <span key={i} className={tone[t]}>
                      {s}
                    </span>
                  ))}
                </code>
              </pre>
              <div className="border-t border-white/10 px-5 py-2.5 font-mono text-xs text-zinc-500">
                <span className="text-emerald-400">$</span> npm i {p.name}
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
