// Every template this package builds. `src/<name>/` holds its React entry
// (main.tsx) and its sample data (data.js), which the built page carries as
// the data script an agent fills. `out` is the committed page, relative to
// the repo root.

export type Template = {
  name: string
  title: string
  about: string
  out: string
}

export const templates: Template[] = [
  {
    name: "exploration",
    title: "{{TITLE}}",
    about:
      "Design exploration page. Fill PAGE, TODAY and ROUNDS in the data script; the page renders from them.",
    out: ".agents/skills/design-exploration/exploration-template.html",
  },
  {
    name: "audit",
    title: "{{TITLE}}",
    about:
      "Design audit findings page. Fill PAGE, DEPTHS, NOTICES, FINDINGS and EXTRA in the data script; the page renders from them.",
    out: ".agents/skills/design-audit/audit-template.html",
  },
  {
    name: "decisions",
    title: "{{TITLE}}",
    about:
      "Design audit decisions page. Fill PAGE, SURFACES and RUNS in the data script; the page renders from them.",
    out: ".agents/skills/design-audit/decisions-template.html",
  },
  {
    name: "storybook",
    title: "{{TITLE}}",
    about:
      "Design storybook page. Fill PAGE, CONTROLS and STATES in the data script; the page renders from them.",
    out: ".agents/skills/design-storybook/storybook-template.html",
  },
]
