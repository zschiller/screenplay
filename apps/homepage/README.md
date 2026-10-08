# Homepage

The marketing site at [screenplay.space](https://screenplay.space): one Next page (`app/page.tsx`) built from the sections in `components/marketing/site/`. In production this project also proxies `/app/*` and `/docs/*` to the app and docs projects (`vercel.json`).

```sh
pnpm --filter homepage dev        # http://localhost:3001 (PORT overrides)
pnpm --filter homepage test       # fails on a straight quote or apostrophe in copy
pnpm --filter homepage og-image   # re-captures app/opengraph-image.jpg
```

How the homepage should look and read (always dark, plain copy, which directions were rejected) is a design rule, not a build note; this file covers how the site is put together and what to recheck when the product changes.

## Product images are HTML

The figures (`components/marketing/excerpts/`) are pieces of the app redrawn in HTML from the docs world (the “Northwind” team in `apps/app/screenshots/docs/`), not screenshots. They stay sharp at any width and use the app’s real components and tokens. `Fit` (`excerpts/fit.tsx`) lays each one out at the app’s own size and scales it down to the column, never up.

They don’t refresh themselves. When the app’s UI changes in a way a figure shows, redraw that excerpt. To see what the app looks like now, shoot the docs world with `pnpm --filter app screenshots:docs --screens hero,frame-selected --themes dark --no-frame`.

The link preview (`app/og/page.tsx`) is captured into `app/opengraph-image.jpg` by `pnpm --filter homepage og-image`. Re-run it whenever Fig. 1 or the headline changes.

## Styles

`app/marketing.css` imports `@workspace/ui/globals.css` itself. A CSS file imported separately isn’t run through Tailwind, so its `@theme` block (the heading font, the selection colour) would silently do nothing.

## Before and after shots

Shoot a production build (`next build && next start`): `next dev` draws Next’s “N” indicator over the page. Use `playwright-core` (the package depends on it) with Chromium at `/opt/pw-browsers/chromium` in a cloud container.

## Claims the homepage must not make

Each of these was on the page once and was false. Check the code before writing anything near them.

- **The Mac app doesn’t work offline, and code does leave the machine.** The agent CLI sends code to its model provider, the chat adapter is fetched with `npx -y` (`apps/app/lib/agent/harnesses/`), and working out how to run a new repository sends its README and config to the model. What is true: no account, no Screenplay servers, no telemetry.
- **The Mac app has no sharing.** Invites, cursors and comments are excluded from the desktop build profile (`apps/app/lib/capabilities.ts`).
- **Knob values belong to one frame** (`knobValues` on the layer, `apps/app/lib/types.ts`). They never update other branches or write back into code.
- **Shared state is per frame**, synced between viewers and play mode, never across frames.
- **The Mac app is Apple Silicon only** (`Screenplay_<version>_aarch64.dmg` in `apps/desktop/scripts/release.mjs`) and has **no auto-update**.
- **There’s no Screenplay-run service** to sign up for. The web app is self-hosted.
- **Self-hosting sells multiplayer** (a team canvas, comments, shared chats), not the npm packages, which are an implementation detail.

## FAQ facts to recheck

`components/marketing/site/faq.tsx` states facts about the product. When agent support, hosting or platform support changes, update the FAQ in the same PR.

| Question | Fact | Where it lives |
| --- | --- | --- |
| Which agents | Mac chats run Antigravity, Claude Code, Codex or OpenCode through the user’s own CLI login. Hosted chats use only the built-in agent. | `apps/app/lib/agent/acp/engine-choice.ts`, `apps/app/lib/agent/harnesses/` (`SANDBOX_HARNESSES` installs CLIs for hosted terminals only) |
| Mac app or host it | No Screenplay-run service; the web app is self-hosted. | |
| What the Mac app needs | Apple Silicon only; no Intel, Windows or Linux build. | `apps/desktop/scripts/release.mjs` |
| Do I need GitHub | Optional on the Mac (a local folder or any clone URL); hosted signs in with GitHub and uses GitHub repositories. | |
| Does code leave my machine | Only through the agent (see the claims above). | |
| What hosting takes | Vercel, Postgres, Liveblocks, Vercel Blob, Vercel Sandbox, a GitHub OAuth app and a model provider key. | `apps/docs/content/self-hosting/` |
