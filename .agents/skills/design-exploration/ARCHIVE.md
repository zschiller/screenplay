# Design archive

Reference for the last step of [`design-exploration`](SKILL.md), [`design-audit`](../design-audit/SKILL.md) and [`design-storybook`](../design-storybook/SKILL.md): keeping a finished page where everyone with the repo can open it. Published pages are private to their owner, so the **archive** is the copy the team reads.

The archive is an orphan branch named `claude/design-archive`. Check for it with `git ls-remote origin claude/design-archive`. When the repo has no such branch, the owner keeps no archive and this step is done.

## The branch

- One folder per page, named `<YYYY-MM-DD>-<slug>` from the page's last update and its title.
- A root `README.md` holds the index: a table of date, title linked to its folder, and the page's one-line question, newest first.
- The branch keeps its `vercel.json` files with `"git": { "deploymentEnabled": false }`, so a push starts no deployments.
- Every change is a new commit on top. The branch stays orphan and its history stays whole: push the branch by name, and leave main untouched.

## Archive a page

1. Check out the branch in a scratch worktree: `git fetch origin claude/design-archive && git worktree add -B claude/design-archive <scratch>/design-archive origin/claude/design-archive`.
2. List the page's published files and download every one into the page's folder, keeping their published paths. A page archived before (a later round of the same exploration) reuses its folder: replace the files with the current version.
3. Write the folder's `README.md`: the title, the original page link, the date, the owner's quote and the question, the outcome (picks, sign-off, or notes), the never-re-offer list, and the PR or issue it led to.
4. Add or update the page's row in the root `README.md`, then commit and `git push origin claude/design-archive`.

Done when the page's row is in the index on the remote branch and its folder opens locally with every capture.
