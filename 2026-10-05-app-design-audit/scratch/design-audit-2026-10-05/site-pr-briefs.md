# Docs + homepage audit plan, 5 Oct 2026: PR briefs

Plan: https://claude.ai/artifact/6or8bbZdVibPiHaTMDu5au · Audit page (findings, captures, file:line): https://claude.ai/artifact/SjbF6kWmujb6pYse6YNQoP
Zack's picks (04:35Z): Fix all. Docs ids P1-P6, H1-H2, N1-N3; homepage ids P7-P9, H3-H4, N4-N7 (renumbered on the combined page; the underlying findings.json/patches use the homepage's own P1-P3/H1-H2/N1-N4). One thread per PR, branch from latest main, before/after shots per design rules, curly quotes, `pnpm --filter docs test` / `pnpm --filter homepage test`.

D1. Docs catch up with what shipped (P1-P6, H2, N1, N3). Start from /mnt/project-files/design-audit-2026-10-05/docs.patch WITHOUT its N2 hunk (screenshot-row caption CSS in apps/docs/app/globals.css; N2 is PR D3). Main moved: PR #1660 changed apps/docs/content/guides/canvas.mdx and mockups.mdx, so those hunks need reapplying by hand against the new text.
D2. Skills page moves to Using Screenplay (H1 → A). AFTER D1 merges. Move apps/docs/content/guides/building/skills.mdx to guides/skills.mdx, listed after Files in guides/_meta.ts, title “Skills”; redirect /guides/building/skills → /guides/skills (see how PR #1591 did redirects); update the links in settings, coordinator, building/knobs, building/shared-state, mockups, agent, canvas.
D3. Screenshot row captions (N2). WAITS on Zack's option pick (A/B/C; patches docs-n2-option-<a|b|c>.patch in the same folder; C recommended).
M1. Homepage fixes (P7-P9, H4, N4-N7). /mnt/project-files/design-audit-2026-10-05/homepage.patch (applies on main 67a1b63), includes a regenerated opengraph-image.jpg (re-run `pnpm --filter homepage og-image` rather than trusting the binary).
M2. Phone Download goes to the hero's buttons (H3 → A). WAITS on Zack's OK of the shots; patch homepage-h3.patch (header.tsx, hero.tsx), rides after M1.
