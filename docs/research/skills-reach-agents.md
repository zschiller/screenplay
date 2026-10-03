# How account and canvas skills can reach each harness

Research for issue #1528 ("How account and canvas skills can reach each harness"). Researched 2026-10-03 against the adapter versions the repo launches on `origin/main` (`ea1d49b`).

## Question

Screenplay wants two new kinds of skill, each a `SKILL.md` with `name` and `description` frontmatter in the Agent Skills format: per-user **account skills** and per-canvas **canvas skills**. They have to reach every harness turn. For each harness (Claude Code, Codex, OpenCode):

1. Where does it discover skills natively, and does it support Agent Skills at all?
2. Can a per-session or per-turn skills directory outside the repo checkout be passed in, and does that need a permission prompt?
3. Does it reread skills mid-session, or only at session start?
4. Is our own `read_skill` MCP tool enough, or do we need native discovery?

## Answer in brief

| | Claude Code (`claude-agent-acp@0.54.1`, Agent SDK 0.3.197) | Codex (`codex-acp@2.0.1`, `@openai/codex` ^0.159.1) | OpenCode (`opencode acp` v1.18.34, **not wired**) |
|---|---|---|---|
| Agent Skills support | Yes, native (`Skill` tool, `/name`) | Yes, native (skills catalog, `$name`) | Yes, native (`skill` tool) |
| Native user dirs | `~/.claude/skills`, managed-settings `.claude/skills` | `~/.agents/skills`, `$CODEX_HOME/skills` (deprecated), `/etc/codex/skills` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` |
| Native project dirs | `.claude/skills` from cwd up to the repo root, nested dirs on demand | `.agents/skills` from project root to cwd, `.codex/skills` | `.opencode/skills`, `.claude/skills`, `.agents/skills` from cwd up to the worktree |
| **Extra dir per session** | ACP `additionalDirectories: [D]` loads `D/.claude/skills`. Or `_meta.claudeCode.options.plugins: [{type:"local", path:P}]` loads `P/skills` as `plugin:name` | ACP `additionalDirectories: [D]` loads `D/.agents/skills` (adapter calls `skills/extraRoots/set`) | Config `skills.paths: [D]`, for example through the `OPENCODE_CONFIG_CONTENT` env var at spawn. No ACP-level option |
| Permission prompt? | None to load. `additionalDirectories` also pre-grants file access to `D` | None to load. **Side effect:** `D` becomes a writable sandbox root | None by default (`permission.skill` defaults to allow; skill dirs are on the `external_directory` allowlist) |
| Rereads mid-session | Yes: it watches skill dirs, including `--add-dir` ones | Yes: the catalog is built per turn, and a watcher clears the cache (10 s throttle) | No: cached per directory instance for the process lifetime |
| Matters for us? | Barely. Our engine spawns a fresh adapter every turn and resumes with `session/load`, so every harness rediscovers at each turn | Same | Same |

**Recommendation.** Materialize account and canvas skills to a per-turn directory outside the checkout, then point each harness's native discovery at it: `additionalDirectories` for Claude Code and Codex, and `skills.paths` for OpenCode. Keep `read_skill` as the fallback, and keep it for App Skills on harnesses that cannot see the files. `read_skill` alone works, but it loses the native slash and `$` invocation, the native listing budget, and the resource files a skill ships beside `SKILL.md`. Its index also goes stale on a resumed session (see §4).

## Sources and versions

| Thing | Version the repo pins or launches | Primary source read |
|---|---|---|
| ACP SDK (client) | `@agentclientprotocol/sdk@1.1.0` | npm tarball `schema/schema.json` |
| Claude Code adapter | `@agentclientprotocol/claude-agent-acp@0.54.1` (`apps/app/lib/agent/harnesses/claude-code.ts:202`) | npm tarball `dist/acp-agent.js` |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk@0.3.197` (the adapter pins it exactly) | npm tarball `sdk.d.ts` |
| Claude Code docs | current | [skills](https://code.claude.com/docs/en/skills), [Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills), [Agent SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins), [plugins reference](https://code.claude.com/docs/en/plugins-reference) |
| Codex adapter | `@agentclientprotocol/codex-acp@2.0.1` (`apps/app/lib/agent/harnesses/codex.ts:241`) | npm tarball `dist/index.js` |
| Codex | `@openai/codex` `^0.159.1` (the adapter's dependency) | [openai/codex@rust-v0.159.1](https://github.com/openai/codex/tree/rust-v0.159.1/codex-rs) `ext/skills/`, `app-server/src/skills_watcher.rs`, `config/src/skills_config.rs` |
| OpenCode | not wired (`acpAdapter: null`, `apps/app/lib/agent/harnesses/opencode.ts:266`, `:313`). Latest is `opencode-ai@1.18.34` | [sst/opencode@v1.18.34](https://github.com/sst/opencode/tree/v1.18.34) `packages/opencode/src/skill/`, `tool/skill.ts`, `agent/agent.ts`, `acp/service.ts`, `packages/web/src/content/docs/skills.mdx` |

The sandbox's egress proxy blocked `developers.openai.com`. Codex facts therefore come from Codex's source at the pinned tag, not from its docs page (`docs/skills.md` in the repo only links out to that page).

Short link prefixes:

- `CAA` = `https://unpkg.com/@agentclientprotocol/claude-agent-acp@0.54.1/`
- `SDK` = `https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.197/`
- `CXA` = `https://unpkg.com/@agentclientprotocol/codex-acp@2.0.1/`
- `CX` = `https://github.com/openai/codex/blob/rust-v0.159.1/codex-rs/`
- `OC` = `https://github.com/sst/opencode/blob/v1.18.34/`

## 0. What the repo does today

- **ACP has no skills concept.** `NewSessionRequest`, `LoadSessionRequest` and `ResumeSessionRequest` carry `cwd`, `additionalDirectories`, `mcpServers` and `_meta`. `PromptRequest` carries `sessionId`, `prompt` and `_meta` (SDK `schema.json`). The only portable per-session lever is `additionalDirectories`. Everything else is adapter `_meta`, env, or config files.
- **What we send.** `AcpSession.open` sends `cwd`, `mcpServers` and an optional `_meta` (`apps/app/lib/agent/acp/session.ts:437-462`). It **never sends `additionalDirectories`**. The only `_meta` is the Coordinator's `{ claudeCode: { options: { allowedTools } } }` (`apps/app/lib/agent/coordinator-mcp.ts:118-122`).
- **One adapter process per turn.** The engine spawns the adapter, opens or resumes the session with `session/load`, prompts, and always closes it in `finally` (`apps/app/lib/agent/acp/acp-engine.ts:250-318`; the comment at `:308` cites Codex's writer lock, #1271). Every turn is therefore a fresh harness process that rescans skills at startup.
- **Skill index as prompt text.** ACP has no system-prompt channel, so the system prompt, including the skill index and the `read_skill` instructions (`apps/app/lib/agent/config.ts:213-224`), is prepended as a text block **only on a fresh session**. A resumed session gets only the new user message (`acp-engine.ts:258-262`, `:376-401`). A skill added after the chat's first turn is therefore never listed to a desktop harness, though `read_skill` can still fetch it by name.
- **`read_skill` over MCP.** Workspace chats on a harness get the Chat Target's tools over `/api/agent/mcp` (`apps/app/app/api/agent/mcp/route.ts`), including `read_skill`. It resolves Repo Skills (`.claude/skills` in the sandbox) before App Skills (`apps/app/lib/agent/tools.ts:264-284`; `lib/skills/repo-skills.ts`). The route is local-build only.
- **Hosted vs desktop.** The external (ACP) engine runs only under `AGENT_ENGINE=external` on a local build (`apps/app/lib/agent/acp/resolve-live-engine.ts:88`). On hosted, chat uses the in-process engine, and harnesses run only as an interactive CLI in the Sandbox terminal, whose home is `/vercel`. There, native user dirs (`/vercel/.claude/skills`, `/vercel/.agents/skills`) are the only route: there is no ACP session to pass options to.
- **Duplication already today.** On desktop, Claude Code natively loads the worktree's `.claude/skills` *and* the user's own `~/.claude/skills`, because the adapter defaults `settingSources: ["user", "project", "local"]` (`CAA` `dist/acp-agent.js:2552`). The same Repo Skills are also in our `read_skill` index. OpenCode reads `.claude/skills` too. Codex does not: it reads `.agents/skills`.

## 1. Claude Code (Claude Agent SDK via `claude-agent-acp`)

**Support and locations.** "Claude Code skills follow the Agent Skills open standard" ([skills](https://code.claude.com/docs/en/skills)). Locations from the "Where skills live" table: enterprise (managed settings dir), personal `~/.claude/skills/<name>/SKILL.md`, project `.claude/skills/` from the start dir up to the repo root, nested `<subdir>/.claude/skills` (loaded the first time Claude touches files there), additional directories (`.claude/skills` inside a `--add-dir` dir), plugins, and skills synced from claude.ai into `~/.claude/skills/synced/`. In the SDK, discovery "loads skills from the filesystem locations governed by `settingSources`", and "The SDK doesn't provide a programmatic API for registering them" ([Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills)).

**Per-session extra dir: three routes, all reachable from our ACP client.**

1. **ACP `additionalDirectories`.** The adapter merges `params.additionalDirectories` (or legacy `_meta.additionalRoots`) with `_meta.claudeCode.options.additionalDirectories` into SDK `additionalDirectories` (`CAA` `dist/acp-agent.js:2659-2667`). It also advertises `sessionCapabilities.additionalDirectories` (`:422`). Docs: "Directories the Agent SDK adds through `additionalDirectories` … load the same way, because the SDK passes them as `--add-dir`", loading that dir's `.claude/skills/`, `.claude/commands/` and `.claude/agents/`. It "depend[s] on the `project` setting source". The `permissions.additionalDirectories` *setting* "grants file access only and loads none of these" ([skills](https://code.claude.com/docs/en/skills), "Load skills from a directory outside the project"). So write `D/.claude/skills/<name>/SKILL.md` and pass `additionalDirectories: [D]`.
2. **`plugins` through `_meta`.** The adapter spreads `_meta.claudeCode.options` into the SDK `Options` (`CAA` `dist/acp-agent.js:2523`, `:2550-2554`). SDK `plugins?: SdkPluginConfig[]` takes `{ type: "local", path, skipMcpDiscovery? }` (`SDK` `sdk.d.ts:1705`, `:3879-3893`). The path is the plugin root, "the parent of `skills/`", and plugin skills are "namespaced with the plugin name", invoked as `/plugin-name:skill-name` ([Agent SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins)). The manifest is optional, and without one the name comes from the directory ([plugins reference](https://code.claude.com/docs/en/plugins-reference)). This route keeps account and canvas skills in their own namespace, for example `canvas:foo`, so they cannot collide with Repo or personal skills.
3. **`settingSources` / `skills` through `_meta`.** `settingSources?: ('user'|'project'|'local')[]`. `skills?: string[] | 'all'` is "a context filter, not a sandbox" (`SDK` `sdk.d.ts:1844-1867`). Use it to hide the user's own `~/.claude/skills` from a canvas session (`settingSources: ["project","local"]`), or to allow only a named set.

**Permission prompts.** Loading a skill from any of these routes asks nothing. Passing `additionalDirectories` also *grants* file access to `D`, so the model reading a skill's `references/` or `scripts/` there does not trip the outside-cwd prompt. That prompt would otherwise reach our approval gate as an ACP `requestPermission` (see `files-reach-agents.md`). Invoking skills can be scoped with `Skill(name)` permission rules. Two risks for user-authored canvas skills:

- A skill's `allowed-tools` frontmatter "grants permission for the listed tools during the turn that invokes the skill … without prompting you for approval". "Workspace trust doesn't gate this field" ([skills](https://code.claude.com/docs/en/skills), "Pre-approve tools for a skill"). One canvas member's skill could therefore bypass Screenplay's approval gate for another member's turn.
- `` !`cmd` `` lines run when a local skill renders. Outside auto mode, a command that isn't already allowed aborts the invocation rather than prompting. `disableSkillShellExecution` turns this off.

Either strip `allowed-tools` and `!` lines when materializing, or set the matching settings through `_meta.claudeCode.options.settings` (not verified end to end).

**Mid-session rereads.** "Claude Code watches skill directories for file changes … under `~/.claude/skills/`, the project `.claude/skills/`, or a `.claude/skills/` inside an `--add-dir` directory", and picks them up "without a restart" ([skills](https://code.claude.com/docs/en/skills), "Live change detection"). A top-level skills dir created after start needs `/reload-skills`. The SDK exposes `reloadSkills()`, `reloadPlugins()` and a `SessionStart` hook `reloadSkills` flag (`SDK` `sdk.d.ts:2381-2387`, `:4420`). The adapter forwards the SDK's `commands_changed` as an ACP `available_commands_update` (`CAA` `dist/acp-agent.js:1003-1016`). Since we spawn per turn, this is a bonus only.

**Native invocation and progressive disclosure.** Descriptions are listed in context, and the body loads only when invoked. The listing is capped at 1% of the context window, and each entry's `description` plus `when_to_use` at 1,536 characters. After compaction, invoked skills are re-attached at up to 5,000 tokens each, within a 25,000-token total ([skills](https://code.claude.com/docs/en/skills), "Skill content lifecycle", "Skill listing budget"). The adapter reports skills as ACP slash commands (`getAvailableSlashCommands`, `CAA` `dist/acp-agent.js:3359-3390`), and a prompt starting with `/name` runs it. Our client currently treats `available_commands_update` as a status update and drops it (`acp-engine.ts:568-574`).

## 2. Codex (`codex-acp` over the Codex app-server)

**Support and locations.** Codex has a full skills extension (`CX` `ext/skills/`). It renders a catalog of name, description and path into the turn, with explicit progressive-disclosure instructions: "If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches … you must use that skill", then "open and read its `SKILL.md` completely" (`CX` `ext/skills/src/catalog_prompt.rs`). Skill roots (`CX` `ext/skills/src/host_roots.rs`):

- User config layer: `$CODEX_HOME/skills` ("Deprecated user skills location … kept for backward compatibility"), `~/.agents/skills`, and the system cache under `$CODEX_HOME`.
- System layer: `<system config dir>/skills` (Admin scope).
- Project config layers: `<project>/.codex/skills`.
- `.agents/skills` in each directory from the project root (found by root markers, default `.git`) down to cwd.
- Plugin skill roots, plus **runtime extra roots** (scope `User`).

The catalog's budget defaults to "2% of the model context window and is capped at 10,000 tokens" (`CX` `config/src/skills_config.rs:38-43`). Codex does **not** read `.claude/skills`, so our Repo Skills reach Codex only through `read_skill`.

**Per-session extra dir.** `codex-acp` maps each ACP `additionalDirectories` entry `D` to `D/.agents/skills` and calls app-server `skills/extraRoots/set`. It does this on new, load, resume, fork **and before every prompt** (`refreshSkills`, `CXA` `dist/index.js:34138-34147`, `:33353`, `:33879-33880`, `:34233`). Entries must be absolute (`readAdditionalDirectories`, `:34457-34480`). `skills/list` is called with `cwds: [cwd, ...additionalDirectories]` to build the ACP command list (`:35644-35647`). So write `D/.agents/skills/<name>/SKILL.md` and pass `additionalDirectories: [D]`. Note that extra roots are set app-server-wide (`HostSkillsService::set_extra_roots`, `CX` `ext/skills/src/host_service.rs:154-162`). That is harmless here, since we run one adapter per turn.

**Permission prompts.** None to load or list. **Side effect:** the same `additionalDirectories` are added to the sandbox's `writableRoots` under `workspaceWrite` (`CXA` `dist/index.js:34505-34511`), so Codex could edit the materialized skill copies. That is acceptable if we rematerialize every turn. Reading `SKILL.md` outside cwd needs no prompt, because Codex's read access is not confined to cwd (see `files-reach-agents.md`). Other levers: `CODEX_HOME` would move `~/.codex`, including the auth and `config.toml` we seed (`codex.ts:162-191`), so it is the wrong lever. Writing into `~/.agents/skills` works too, but it is shared by every session for that user, which fits account skills and not canvas skills.

**Mid-session rereads.** The app-server's `SkillsWatcher` watches the skill roots, runtime extra roots included. On change it calls `skills_service.clear_cache()` and emits `skills/changed`, throttled to 10 s (`CX` `app-server/src/skills_watcher.rs:26-28`, `:72-80`, `:162-166`). Skills are listed per turn (`providers.list_for_turn`, `CX` `ext/skills/src/extension.rs:599-610`), and `set_extra_roots` clears the cache (`host_service.rs:154-162`). The adapter ignores `skills/changed` (`CXA` `dist/index.js:30517`). It republishes `available_commands_update` after each completed turn, only when the commands changed (`:39771-39775`).

**Native invocation.** Skills appear as ACP commands named `$name`. A `$name` prompt is passed through as text, not handled by the adapter (`CXA` `dist/index.js:35649-35667`, `:35764`), and Codex's trigger rules act on it. `/skills` lists them (`:35837-35845`).

## 3. OpenCode (`opencode acp`, not wired today)

**Support and locations.** "Agent skills let OpenCode discover reusable instructions from your repo or home directory. Skills are loaded on-demand via the native `skill` tool" (`OC` `packages/web/src/content/docs/skills.mdx`). Locations:

- `.opencode/skills`, `~/.config/opencode/skills`, `.claude/skills`, `~/.claude/skills`, `.agents/skills`, `~/.agents/skills`.
- Project paths are walked "up from your current working directory until it reaches the git worktree" (same doc; `OC` `packages/opencode/src/skill/index.ts:175-210`).
- `OPENCODE_DISABLE_EXTERNAL_SKILLS` turns off the `.claude` and `.agents` locations, and the Claude-specific toggle turns off `.claude` only (`OC` `packages/opencode/src/effect/runtime-flags.ts:21-27`).
- Frontmatter: `name` (1–64, `^[a-z0-9]+(-[a-z0-9]+)*$`, must match the directory) and `description` (1–1024 characters) are required. Unknown fields are ignored, so Claude's `allowed-tools` has no effect here.

**Per-session extra dir.** No ACP option: `opencode acp` does not read `additionalDirectories`. Instead, config `skills.paths` ("Additional paths to skill folders", absolute, relative to cwd, or `~/`) and `skills.urls` are scanned for `**/SKILL.md` (`OC` `packages/core/src/v1/config/skills.ts`; `skill/index.ts:211-227`). `OPENCODE_CONFIG_DIR` adds a `.opencode`-style dir whose `{skill,skills}/**/SKILL.md` is scanned (`skill/index.ts:205-208`). Since we spawn the adapter per turn, the spawn env can carry `OPENCODE_CONFIG_CONTENT='{"skills":{"paths":["D"]}}'` (`OC` `packages/core/src/flag/flag.ts:22`, merged in `packages/opencode/src/config/config.ts`).

**Permission prompts.** The `skill` tool calls `ctx.ask({ permission: "skill", patterns: [name] })` (`OC` `packages/opencode/src/tool/skill.ts:27-32`), but the default agent permissions are `"*": "allow"`. The discovered skill dirs are added to the `external_directory` allowlist, so reading a skill's sibling files outside cwd does not prompt (`OC` `packages/opencode/src/agent/agent.ts:101-125`).

**Mid-session rereads.** No. Discovery and state are `InstanceState` caches keyed by directory, invalidated only when the instance is disposed (`OC` `packages/opencode/src/skill/index.ts:257-285`; `effect/instance-state.ts:25-44`). With one process per turn, this still means per-turn freshness.

**Native invocation.** The `skill` tool's description lists `<available_skills>`. The tool returns the body plus the skill's base directory and a sample of its files (`tool/skill.ts:34-60`). The ACP layer also surfaces skills as slash commands whose template is the skill content (`OC` `packages/opencode/src/acp/service.ts:745-785`).

## 4. Is `read_skill` alone enough?

It works on every harness today, because MCP tools reach all three. But compared with native discovery it loses:

- **Freshness on resume.** The index is folded into the first prompt only (§0). Account and canvas skills added or edited mid-chat never appear in a resumed desktop session's listing. Native discovery rescans every turn, because each turn spawns a new process.
- **Native invocation.** `/name` (Claude Code, OpenCode) and `$name` (Codex) come only from native discovery. Our `[skill: name]` marker plus the "MANDATORY" instruction (`config.ts:222`) is a prompt-level imitation.
- **Supporting files.** `read_skill` returns `SKILL.md` text only. A skill's `scripts/`, `references/` and `assets/` are invisible unless they are on disk where the harness can read them. All three harnesses tell the model to resolve relative paths against the skill's directory.
- **Budget and compaction.** Native listings are budgeted (Claude: 1% of the context window; Codex: 2%, capped at 10,000 tokens). Claude re-attaches invoked skills after compaction. Our text index sits in the first user message and can be summarized away.
- **Codex's trigger rules** are tied to its own catalog.

`read_skill` remains right for **App Skills** (bundled, branch-independent) and for the hosted in-process engine, which has no harness.

## Implications for a design (not decisions)

1. **Materialize per turn.** Before spawning the adapter, write account skills and the canvas's skills to an app-owned directory outside the worktree. On desktop, for example `~/.screenplay/skills/<room>/<user>/`, laid out for every harness at once: `D/.claude/skills/<name>/`, `D/.agents/skills/<name>/`, or a symlink between the two. Then pass `additionalDirectories: [D]` on both `session/new` and `session/load`. That one field feeds Claude Code and Codex. For OpenCode, add `OPENCODE_CONFIG_CONTENT` with `skills.paths` once it is wired.
2. **Or a Claude-only namespace.** `_meta.claudeCode.options.plugins: [{ type: "local", path: P }]` gives `canvas:name` names that cannot collide with Repo or personal skills.
3. **Sanitize user-authored skills.** Strip `allowed-tools` and `` !`…` `` before writing, or disable them through settings. Otherwise one canvas member's skill can self-grant tools without prompting during another member's turn on Claude Code.
4. **Decide on duplication.** Claude Code and OpenCode already natively load the worktree's `.claude/skills` and the user's own `~/.claude/skills`, which overlap the `read_skill` index. Either drop natively visible skills from the prompt index for those harnesses, or accept the duplicate listing.
5. **Hosted terminal.** The only route is writing into the Sandbox user's home (`/vercel/.claude/skills`, `/vercel/.agents/skills`) at provision time.
6. **Read `available_commands_update`** if the composer should offer native skill commands. It is dropped today.

## Unverified

- No live end-to-end run of any route. Every claim is from source and docs at the pinned versions.
- Name collisions between an `--add-dir` skill and a project or personal skill of the same name: the docs' precedence table does not list additional directories.
- Whether the adapter's `_meta.claudeCode.options.settings` can carry `disableSkillShellExecution` or `allowManagedPermissionRulesOnly`-style controls for this purpose.
- `OPENCODE_CONFIG_CONTENT` merge precedence against project `opencode.json`. The OpenCode ACP adapter's behavior once wired.
- Codex's official docs page (blocked). Whether `.codex/skills` project roots need a trusted project.
- Codex catalog freshness within a single long-lived turn. Irrelevant to us, since we spawn per turn.
