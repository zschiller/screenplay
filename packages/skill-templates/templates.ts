// Every template this package builds. `src/<name>/` holds its React entry
// (main.tsx) and its sample data (data.js), which the built page carries as
// the data script an agent fills. `out` is the committed page, relative to
// the repo root, with the bundle inlined so it publishes as an Artifact.
// `skill` is the App Skill that ships the template as a data page plus a
// runtime file it loads with a `skill:` reference (see appOutputs).

export type Template = {
  name: string
  title: string
  about: string
  out: string
  skill: string
}

/** The App Skill folders, relative to the repo root. */
export const APP_SKILLS = "apps/app/lib/skills"

/**
 * Where a template lands in its App Skill: the data page a Mockup holds, and
 * the runtime (script and styles) its `src` names, and the fonts it links,
 * as files of the Skill.
 */
export function appOutputs(t: Template) {
  const runtime = `${t.name}-runtime.js`
  return {
    page: `${APP_SKILLS}/${t.skill}/${t.name}-template.html`,
    runtime: `${APP_SKILLS}/${t.skill}/${runtime}`,
    ref: `skill:${t.skill}/${runtime}`,
    // One per Skill, shared by its templates
    fonts: `${APP_SKILLS}/${t.skill}/fonts.css`,
    fontsRef: `skill:${t.skill}/fonts.css`,
  }
}

export const templates: Template[] = [
  {
    name: "exploration",
    title: "{{TITLE}}",
    about:
      "Design exploration page. Fill PAGE, TODAY and ROUNDS in the data script; the page renders from them.",
    out: ".agents/skills/design-exploration/exploration-template.html",
    skill: "screenplay-explore-with-mockups",
  },
  {
    name: "audit",
    title: "{{TITLE}}",
    about:
      "Design audit findings page. Fill PAGE, DEPTHS, NOTICES, FINDINGS and EXTRA in the data script; the page renders from them.",
    out: ".agents/skills/design-audit/audit-template.html",
    skill: "screenplay-design-audit",
  },
  {
    name: "decisions",
    title: "{{TITLE}}",
    about:
      "Design audit decisions page. Fill PAGE, SURFACES and RUNS in the data script; the page renders from them.",
    out: ".agents/skills/design-audit/decisions-template.html",
    skill: "screenplay-design-audit",
  },
  {
    name: "storybook",
    title: "{{TITLE}}",
    about:
      "Design storybook page. Fill PAGE, CONTROLS and STATES in the data script; the page renders from them.",
    out: ".agents/skills/design-storybook/storybook-template.html",
    skill: "screenplay-design-storybook",
  },
]
