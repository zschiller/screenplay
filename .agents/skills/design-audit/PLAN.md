# Combined plan

Reference for stage 2 of [`design-audit`](SKILL.md): the sections of a surface's combined plan Artifact, in page order.

1. **Header**: the surface and date; a lede with the counts (findings, overlaps merged, proposed PRs, calls); and links to each source audit and to any built branch or patch.
2. **The sequence**: the PRs, numbered in build order. Give each a title, its size and kind ("Copy only · 6 files"), and what it depends on. Order them this way: false claims and bugs first, already-built patches early, then redesigns after the PRs they build on. Mark any step that needs the owner's own machine, such as a release or a platform-only test.
3. **Needs your call**: the numbered calls. Each has a one-line question, the finding tags and the PR it gates, one or two sentences of context, and 2 or 3 options with a one-line consequence for each. Put the recommended option first and mark it. Name the PRs that can start before any call is answered.
4. **Worth your oversight**: defaults the owner may want to watch. Examples: a release, copy that changes the pitch, a change every collaborator sees, captures that don't show the fix, and edits another surface's plan depends on.
5. **Defaults I picked and what was merged**: where each duplicate across audits ships, which findings were dropped and why, and the check against the owner's design rules.
6. **Per-PR sections**: why, depends on, and the files it touches. Then each finding with its tag, the concrete change and its captures. Copy the captures from the audit Artifacts through `files` with `{artifact, path}` sources.
7. **Out of scope**: findings moved to another surface's plan. For example, app bugs found by the docs audit go to the app's plan.
