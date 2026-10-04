# Decisions page

Reference for stage 3 of [`design-audit`](SKILL.md): how to turn the combined plans' calls into `decisions-template.html`.

## Filling the template

1. Read each combined plan with the Artifact tool. For a long page, have a short script extract the `<section class="pr">` blocks, headings, and image `src` and caption pairs.
2. For each call, add a question to `SURFACES` in the data script:
   - `id`: the surface's letter from stage 0 plus a number (H1, D3, A2)
   - `where`: the finding tags and the PR it gates
   - `t`: the question
   - `c`: the context
   - `o`: the options, recommendation first
   - `img`: the one or two captures that show exactly the thing being decided, with light and dark versions when the plan has both. Captures that only relate to the question loosely stay out.
3. Add every PR to `RUNS` for its surface. Give it `""` when it runs regardless, or `"waits on H1, H3"` when a call gates it.
4. Fill in `PAGE`: the title, the surfaces label, the plans' name and one link per plan; the jump links and question count come from `SURFACES`. Load `artifact-design`, swap the token block (shadcn variable names) and font link for the repo's brand, and run `node --check` on the data script once. Publish with `files` mapping each image path to `{artifact: <plan url>, path: <its published path>}`.
5. Reply with the link. Tell the owner to pick an answer for each call, press Copy decisions and paste the text back, and that any call left blank keeps the recommendation.

The template is a built page: read and edit only the data script above its `Generated below this line` marker. Everything else works as is: rendering, the None of these and Write my own choices, notes, the answered count, Copy decisions and its fallback of selecting the text, and drafts saved to localStorage.

## Copied text

Stage 4 reads this format:

```
Decisions on the site, docs and app audit plans (30 Sep 2026)

SITE
H1. Should the figures sell versions of one change, or parallel tasks?
   → Versions (recommended)
H6. Swap Pick elements for a Play mode card?
   → None of these
   Note: pick elements is useful. Let's think about what these cards should be.
```
