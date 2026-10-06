<h1 align="center">Screenplay</h1>

<p align="center"><strong>From idea to code, on one canvas.</strong></p>

<p align="center">
  Coding agents plan, mock up and build from your own repo, with every version
  live side by side.
</p>

<p align="center">
  <a href="https://screenplay.space">Website</a> ·
  <a href="https://screenplay.space/docs">Docs</a> ·
  <a href="https://screenplay.space/docs/guides/quickstart">Quickstart</a> ·
  <a href="https://github.com/zschiller/screenplay/releases">Download for Mac</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/screenshots/hero.dark.webp">
  <img alt="A Screenplay canvas: layers in the sidebar, desktop and mobile previews of a marketing site on the canvas, and the agent’s chat on the right" src="apps/docs/public/screenshots/hero.light.webp">
</picture>

## Every handoff starts from scratch

The plan sits in a doc, the mockup in a design tool that has never seen your
components, and the build in a terminal and a browser tab. Screenplay puts all
three on one canvas, next to your code.

## Plan it, sketch it, build it

Type a prompt anywhere on the canvas and an agent makes it right there. It
reads your code first, so whatever it makes fits your app.

- **Plan it.** A plan or a spec, written as a document next to the work. It
  stays current as things change.
- **Sketch it.** Mockups made with your own components, styles and copy.
  Compare a few takes before anything gets built.
- **Build it.** The change runs live in a preview of its own, right beside the
  other versions.
- **Ship it.** Open a pull request for the version you keep.

Chats share memory, files and skills, so what you tell one chat, every chat
knows.

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/screenshots/coordinator.dark.webp">
        <img alt="The Coordinator panel beside a canvas, offering questions about the canvas" src="apps/docs/public/screenshots/coordinator.light.webp">
      </picture>
      <p><strong>Ask the Coordinator.</strong> One chat for the whole canvas. It starts a chat for each version or task, follows every one, and tells you when one needs you.</p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/screenshots/plan-card.dark.webp">
        <img alt="An approved plan card in a chat, listing the steps the agent will take" src="apps/docs/public/screenshots/plan-card.light.webp">
      </picture>
      <p><strong>Review the plan first.</strong> Turn on Plan and the agent investigates, then presents its approach for you to approve before any code changes.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/screenshots/play-agent.dark.webp">
        <img alt="Play mode: a chat’s app full screen with its chat docked on the right" src="apps/docs/public/screenshots/play-agent.light.webp">
      </picture>
      <p><strong>Try it full screen.</strong> Play mode opens any chat’s app as a clickable prototype, with its chat docked alongside.</p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/screenshots/play-knobs.dark.webp">
        <img alt="The Knobs panel over a preview, with color, slider, text, switch and tabs controls" src="apps/docs/public/screenshots/play-knobs.light.webp">
      </picture>
      <p><strong>Tweak without code.</strong> Knobs your app declares become live controls on the canvas and in play mode, so you can try colors, copy and layouts with no rebuild.</p>
    </td>
  </tr>
</table>

## Two ways to run it

|                  | Desktop app                                                                      | Hosted app (you deploy it)                                                                                |
| ---------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **For**          | One person on a Mac with Apple silicon                                           | A team, on infrastructure you deploy                                                                      |
| **Chats run in** | Git worktrees on your machine                                                    | A sandbox VM per chat                                                                                     |
| **Agent**        | Claude Code, Codex or OpenCode, with the login and subscription you already have | The built-in agent, on Anthropic, OpenAI, Google, the Vercel AI Gateway or any OpenAI-compatible endpoint |
| **Together**     | Single user                                                                      | Shared canvases, live cursors, comments and live frames                                                   |
| **Start**        | [Quickstart](https://screenplay.space/docs/guides/quickstart)                    | [Self-hosting guide](https://screenplay.space/docs/self-hosting)                                          |

Both are the same product, built from this repository.

## Run from source

You need Node.js 20 or newer, pnpm 9 and git. The local build runs the full
product with no external services (embedded Postgres, a local Yjs server, and
each chat’s code as a git worktree), plus a coding CLI such as Claude Code for the
agent.

```bash
git clone https://github.com/zschiller/screenplay.git
cd screenplay
pnpm install

cd apps/app
NEXT_PUBLIC_SCREENPLAY_LOCAL=1 NEXT_PUBLIC_YJS_HOST=local NEXT_PUBLIC_BASE_PATH= \
SANDBOX_BACKEND=local SCREENPLAY_DB=pglite BLOB_STORE=local-fs AGENT_ENGINE=external \
ENCRYPTION_KEY=$(openssl rand -hex 32) TERMINAL_AUTH_SECRET=$(openssl rand -hex 32) \
  pnpm dev
```

Then open http://localhost:3000. The
[Development guide](https://screenplay.space/docs/contributing) covers the
multi-user build, the desktop app, and every contributor command.

## What’s in this repository

| Path                                                     | What it is                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`apps/app`](apps/app)                                   | The product: canvas, agent runtime and API routes                                            |
| [`apps/desktop`](apps/desktop)                           | The Tauri shell that packages `apps/app` as the Mac app                                      |
| [`apps/docs`](apps/docs)                                 | The docs site, [screenplay.space/docs](https://screenplay.space/docs)                        |
| [`apps/homepage`](apps/homepage)                         | The website, [screenplay.space](https://screenplay.space)                                    |
| [`packages/screenplay-knobs`](packages/screenplay-knobs) | Declare [knobs](https://screenplay.space/docs/guides/building/knobs) in your app                    |
| [`packages/screenplay-state`](packages/screenplay-state) | Share [state](https://screenplay.space/docs/guides/building/shared-state) across viewers of a frame |
| [`packages/ui`](packages/ui)                             | Shared shadcn/ui components                                                                  |

## Contributing

Issues and pull requests are welcome. The docs site is the home for all
documentation, so please add and update pages in
[`apps/docs/content`](apps/docs/content) rather than growing this README. The
screenshots above come from the docs and refresh themselves whenever the app
changes.

## License

MIT. See [LICENSE](LICENSE).
