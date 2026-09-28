# Giving a desktop harness session the Screenplay canvas tools over MCP

Research for issue #861 ("How do we give a harness session on desktop the Screenplay canvas tools?"). Researched 2026-09-28 against the exact adapter versions the repo launches.

## Question

A "Canvas Coordinator" chat on desktop should be able to read the canvas, arrange frames, create a Workspace, and send to a Workspace chat. Desktop chats run through a harness over ACP, so those tools would reach the harness as an MCP server passed in `session/new` / `session/load`. Today the client passes `mcpServers: []` (`apps/app/lib/agent/acp/session.ts:320-335`). This note covers:

1. Does each adapter honor `mcpServers`, and over which transports?
2. How does the MCP server reach and authenticate to the local sidecar?
3. What `cwd` should a coordinator session use?
4. What goes wrong in practice: permission prompts, tool names, limits.

## Sources and versions

| Thing | Version pinned or launched by the repo | Primary source read |
|---|---|---|
| ACP SDK (client) | `@agentclientprotocol/sdk@1.1.0` (`apps/app/package.json:54`) | npm tarball `schema/schema.json` |
| ACP spec | v1 docs | [agent-client-protocol@b8e86aa](https://github.com/agentclientprotocol/agent-client-protocol/tree/b8e86aa02d32f1a0fc21cf28677cd32ba0259d8b/docs/protocol/v1) |
| Claude Code adapter | `npx -y @agentclientprotocol/claude-agent-acp@0.54.1` (`apps/app/lib/agent/harnesses/claude-code.ts:200-203`) | npm tarball `dist/acp-agent.js`, `dist/tools.js` (bundles `@anthropic-ai/claude-agent-sdk` 0.3.197, `package.json:67`) |
| Codex adapter | `npx -y @zed-industries/codex-acp` **unpinned** (`apps/app/lib/agent/harnesses/codex.ts:240-244`). Latest on npm is 0.16.0 | [zed-industries/codex-acp@v0.16.0 (bb59050)](https://github.com/zed-industries/codex-acp/tree/bb590500e8646f6daf879b8b3c6a659fbd29017d), which depends on `openai/codex` tag `rust-v0.137.0` ([f221438](https://github.com/openai/codex/tree/f221438b691b8f749d98f22077c93ebe01923fbe)) |
| opencode | **Not wired for chat**: both opencode descriptors have `acpAdapter: null` (`apps/app/lib/agent/harnesses/opencode.ts:264-266`, `:311-313`). Its native adapter would be `opencode acp` | [sst/opencode@v1.18.33 (51ef4be)](https://github.com/sst/opencode/tree/51ef4be1d3c122f18fefb510dca8d778571f4f18/packages/opencode/src/acp) |
| MCP spec | 2025-11-25 | [modelcontextprotocol@ab3a39c](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/ab3a39c13bd23be691c2760e1c6c5c15a64582e1/docs/specification/2025-11-25/basic/transports.mdx) |

Short link prefixes used below:

- `CAA` = `https://unpkg.com/@agentclientprotocol/claude-agent-acp@0.54.1/`
- `SDK` = `https://unpkg.com/@agentclientprotocol/sdk@1.1.0/`
- `CXA` = `https://github.com/zed-industries/codex-acp/blob/bb590500e8646f6daf879b8b3c6a659fbd29017d/`
- `CX` = `https://github.com/openai/codex/blob/f221438b691b8f749d98f22077c93ebe01923fbe/codex-rs/`
- `OC` = `https://github.com/sst/opencode/blob/51ef4be1d3c122f18fefb510dca8d778571f4f18/packages/opencode/src/`
- `ACPD` = `https://github.com/agentclientprotocol/agent-client-protocol/blob/b8e86aa02d32f1a0fc21cf28677cd32ba0259d8b/docs/protocol/v1/`

## 1. `mcpServers` support and transports

### What the protocol requires

- `NewSessionRequest` requires both `cwd` and `mcpServers`. `LoadSessionRequest` requires `mcpServers`, `cwd` and `sessionId` (`SDK` `schema/schema.json:6279`, `:6505`).
- `McpServer` is one of four shapes (`schema/schema.json:6311-6380`):
  - `stdio`: the default, with no `type` field. Fields are `name`, `command`, `args` and `env[]`. The schema says "All Agents MUST support this transport".
  - `http`: fields are `name`, `url` and `headers[]`. Only allowed when `mcpCapabilities.http` is true.
  - `sse`: same fields as `http`. Only allowed when `mcpCapabilities.sse` is true.
  - `acp`: **UNSTABLE**. The MCP server is provided over the ACP channel itself. Only allowed when `mcpCapabilities.acp` is true.
- `McpCapabilities` has three booleans, `http`, `sse` and `acp`, and each defaults to false (`schema/schema.json:2499`).
- The spec says new agents SHOULD support HTTP ([`ACPD` session-setup.mdx:373-375](https://github.com/agentclientprotocol/agent-client-protocol/blob/b8e86aa02d32f1a0fc21cf28677cd32ba0259d8b/docs/protocol/v1/session-setup.mdx#L373-L375)). The same page marks SSE "deprecated by the MCP spec" (`session-setup.mdx:~477`).

### Per adapter

| Adapter | Advertised `mcpCapabilities` | Honors `mcpServers` on new/load | stdio | http | sse |
|---|---|---|---|---|---|
| claude-agent-acp 0.54.1 | `{http: true, sse: true}` (`CAA` `dist/acp-agent.js:413-416`) | Yes, on new, load, resume and fork (`:450-456`, `:476-477`, `:2401-2427`) | yes | yes | yes |
| codex-acp 0.16.0 | `http(true)` only (`CXA` [`src/codex_agent.rs:454`](https://github.com/zed-industries/codex-acp/blob/bb590500e8646f6daf879b8b3c6a659fbd29017d/src/codex_agent.rs#L454)) | Yes, on new and load, through the shared `build_session_config` (`codex_agent.rs:336-436`, `:567`, `:683`) | yes | yes (Streamable HTTP) | **silently dropped** |
| opencode 1.18.33 (`opencode acp`) | `{http: true, sse: true}` (`OC` [`acp/service.ts:113-119`](https://github.com/sst/opencode/blob/51ef4be1d3c122f18fefb510dca8d778571f4f18/packages/opencode/src/acp/service.ts#L113-L119)) | Yes, on new, load, resume and fork (`service.ts:196`, `:236`, `:324`, `:395`) | yes | yes | yes |

How each adapter handles the servers it receives:

- **Claude.**
  - `http` and `sse` entries become SDK `{type, url, headers}`. Entries with no `type` become stdio (`CAA` `dist/acp-agent.js:2476-2503`).
  - They are merged into the SDK `mcpServers` together with any passed through `_meta.claudeCode.options.mcpServers` (`:2576`).
  - On `session/load` of a session already live in the same adapter process, the adapter compares a fingerprint of `{cwd, mcpServers}`. If it differs, the adapter tears the session down and recreates it (`:48-52`, `:2401-2421`).
- **Codex.**
  - `McpServer::Sse(..) => {}` is commented "Not supported in codex" (`codex_agent.rs:349-350`). An SSE entry is ignored without any error.
  - `http` becomes `StreamableHttp { url, http_headers }` (`:351-384`). stdio becomes `Stdio { command, args, env, cwd: <session cwd> }` (`:386-424`).
  - Whitespace in the server name is replaced with `_` (`:355`, `:394`).
  - Servers configured in the user's own `~/.codex/config.toml` stay in the list, and the ACP servers are added on top (`:346`).
- **opencode.**
  - Anything with a `type` becomes `{type: "remote", url, headers}`. stdio becomes `{type: "local", command: [command, ...args], environment}` (`OC` [`acp/service.ts:1065-1078`](https://github.com/sst/opencode/blob/51ef4be1d3c122f18fefb510dca8d778571f4f18/packages/opencode/src/acp/service.ts#L1065-L1078)).
  - Each server is registered with `sdk.mcp.add` and the result is wrapped in `Effect.ignore` (`service.ts:1022-1046`), so **a failure to connect is swallowed**.
  - A "remote" server tries Streamable HTTP first and falls back to SSE (`OC` `mcp/index.ts:238-286`).

**Only one transport works in every adapter: `http` (Streamable HTTP).** stdio is guaranteed by the spec, but it would mean shipping and launching a bridge executable per session. SSE is deprecated and codex drops it.

### Repo-side changes this implies

- `AcpSession.open` must pass the server in **both** the `loadSession` and `newSession` calls (`apps/app/lib/agent/acp/session.ts:320-335`).
  - Claude uses the load-time list to rebuild its query process.
  - Codex rebuilds its config from the load-time list.
  - A load that sends `[]` would come back with no canvas tools.
- The client currently sends `clientCapabilities: {}` (`session.ts:315-318`). Before sending an `http` entry, it should read `agentCapabilities.mcpCapabilities.http` from the `initialize` response, because the spec gates `http` on that capability.

## 2. How the MCP server reaches and authenticates to the sidecar

### What the repo already has

- **The sidecar is loopback-only on a random port.**
  - Tauri picks a free port by binding `127.0.0.1:0` (`apps/desktop/src-tauri/src/sidecar.rs:86-88`).
  - It starts Next with `PORT=<port>`, `HOSTNAME=127.0.0.1`, `NEXT_PUBLIC_SCREENPLAY_LOCAL=1` and `AGENT_ENGINE=external` (`sidecar.rs:230-238`).
  - The port changes on every launch, so the URL must be built at session-open time from `process.env.PORT`, plus the base path if one is set. The dev build sets `NEXT_PUBLIC_BASE_PATH=""` (`sidecar.rs:201`).
- **The local build has no request auth at all.**
  - The middleware returns `NextResponse.next()` for every request when `isLocalBuild` is true (`apps/app/proxy.ts:17-20`).
  - Session helpers resolve to the single seeded local user (`apps/app/lib/auth-helpers.ts:35-56`).
  - So any local process that can reach `127.0.0.1:<port>` is "the user".
- **There is precedent for trusting the loopback boundary.**
  - `/api/terminal/host` skips the room and membership credential. Its comment says this is "safe only under the local build's `127.0.0.1` desktop-local trust boundary", and it 404s when the backend isn't local (`apps/app/app/api/terminal/host/route.ts:8-35`).
  - The local terminal WebSocket server binds `127.0.0.1` for the same reason (`apps/app/lib/terminal/local/server.ts:26`, `:93`, `:154`).
- **There is precedent for a scoped credential.**
  - The hosted `/api/terminal/auth` mints a short-lived, room-scoped credential through `issueTerminalCredential` (`apps/app/app/api/terminal/auth/route.ts:18-54`).
  - This is the closest existing pattern for a per-session token.

### What the MCP spec requires of a localhost HTTP server

A Streamable HTTP server **MUST** validate `Origin` and return 403 when it is invalid, to stop DNS rebinding. It **SHOULD** bind to 127.0.0.1, and it **SHOULD** authenticate every connection ([MCP transports.mdx:76-84](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/ab3a39c13bd23be691c2760e1c6c5c15a64582e1/docs/specification/2025-11-25/basic/transports.mdx#L76-L84)).

### Recommendation

Mount a Streamable-HTTP MCP route in the sidecar, for example `/api/agent/mcp`. Pass it to the harness as:

```json
{ "type": "http", "name": "screenplay",
  "url": "http://127.0.0.1:<PORT><basePath>/api/agent/mcp",
  "headers": [{ "name": "Authorization", "value": "Bearer <token>" }] }
```

The route should:

1. 404 unless `isLocalBuild`, mirroring `/api/terminal/host`.
2. Require a random bearer token. The token is minted per coordinator session when the session opens, kept in memory, and **bound to the chat and canvas**, so the server knows which canvas and chat the call acts for without trusting tool arguments.
3. Reject any request that carries an `Origin` header not on its allow list, as the MCP spec requires.

The tool handlers then call the same server-side canvas operations the in-process engine uses. No new transport is needed.

Why a token when the local build is otherwise unauthenticated:

- The token scopes what the call is allowed to act on.
- It blunts DNS-rebinding and other local-process abuse of an endpoint that can create Workspaces and send prompts.

All three adapters forward `headers` unchanged:

- Claude: `CAA` `dist/acp-agent.js:2481-2486`.
- Codex: `http_headers` (`CXA` `src/codex_agent.rs:362-366`).
- opencode: `headers` (`OC` `acp/service.ts:1067-1071`).

## 3. Working folder for a coordinator session

### What the protocol and adapters require

- **The protocol.** `cwd` MUST be an absolute path. It MUST be used for the session wherever the subprocess was spawned, and it MUST be part of the session's root set ([`ACPD` session-setup.mdx:360-367](https://github.com/agentclientprotocol/agent-client-protocol/blob/b8e86aa02d32f1a0fc21cf28677cd32ba0259d8b/docs/protocol/v1/session-setup.mdx#L360-L367)). `session/load` expects the same `cwd` as the original session (`session-setup.mdx:342`).
- **Claude.** `validateCwd` rejects a path that is not absolute, does not exist, or is not a directory, with `invalidParams` (`CAA` `dist/acp-agent.js:2437-2458`). **No git check.** `SettingsManager(cwd)` and `settingSources: ["user","project","local"]` mean `<cwd>/.claude/settings*.json` and `CLAUDE.md` are loaded (`:2472-2474`, `:2552`).
- **Codex.**
  - `config.cwd = cwd.try_into()` converts to an absolute path type; the adapter does no existence check (`CXA` `src/codex_agent.rs:342`).
  - **No git check** in the adapter.
  - A folder Codex doesn't trust yet opens in the `read-only` mode (`CXA` `src/thread.rs:150-158`). Choosing `auto` or `full-access` marks the folder trusted (`thread.rs:208-210`, `:3313-3317`).
- **opencode.**
  - `cwd` becomes the opencode server `directory` for every call (`OC` `acp/service.ts:165-196`).
  - A folder that is not a git repo becomes the "global" project with worktree `/` (`OC` `project/project.ts:217`). That works, but its session list is shared with every other non-git folder.
- **The spawned process.** The external engine also uses `cwd` as the adapter **process's** working directory (`apps/app/lib/agent/acp/spawn-session-factory.ts:128-129`), so the folder must exist before spawn or Node's `spawn` fails.

### What the repo does today

A chat with no sandbox (a layer-targeted chat) gets `cwd = undefined`, and the engine falls back to `"/"` (`apps/app/lib/agent/acp/resolve-live-engine.ts:83-88`, `apps/app/lib/agent/acp/acp-engine.ts:209`). `/` passes every check above, but it has problems:

- Claude would read `/.claude` as project settings and file the session under a project named `/`.
- Codex treats `/` as an untrusted project.
- Any file tool the harness still has would be rooted at the whole disk.

### Recommendation

Give each coordinator a dedicated, **stable**, app-owned folder that is not a git repo, and create it before spawning. For example `<app_data_dir>/coordinator/<canvasId>`. The Tauri shell already creates siblings under `app_data_dir` for `pglite`, `yjs` and `blobs` (`sidecar.rs:217-223`), so pass it in the same way as an env var such as `SCREENPLAY_COORDINATOR_ROOT`. The worktree root already follows this pattern with `SCREENPLAY_WORKTREE_ROOT` (`apps/app/lib/sandbox/local/provider.ts:44-49`).

It must be stable per coordinator chat because the harnesses key sessions by `cwd`:

- `session/load` expects the same `cwd`.
- Claude `listSessions({dir})` filters by it (`dist/acp-agent.js:486`).
- Codex filters its session list by `cwd` (`codex_agent.rs:731-765`).

A per-canvas folder also leaves room to drop a coordinator `CLAUDE.md` or `AGENTS.md` into it later.

## 4. Gotchas

### Permission prompts will hit the plan-approval gate

`AcpSession` answers **every** `session/request_permission` through `ports.requestPlanApproval` and maps approve or reject onto the offered options (`apps/app/lib/agent/acp/session.ts:64-72`, `:498-518`). An MCP tool prompt would therefore look like a plan approval. It needs its own branch: auto-select `allow_*` for Screenplay's own tools, or a separate UI.

What each adapter does:

- **Claude.**
  - An MCP tool with no allow rule goes through `canUseTool`. That sends `session/request_permission` with options `allow_always` ("Always Allow all mcp__…"), `allow` (allow_once) and `reject` (reject_once) (`CAA` `dist/acp-agent.js:2097-2112`).
  - The tool-call title is the raw tool name, `mcp__screenplay__<tool>`, with kind `other` (`dist/tools.js:333-338`).
  - The default mode comes from the user's `permissions.defaultMode`, and is `"default"` when that is unset (`dist/acp-agent.js:194-197`, `:2520`).
  - **To avoid the prompts,** pass `_meta: { claudeCode: { options: { allowedTools: ["mcp__screenplay__*"] } } }` on `session/new` and `session/load`. `userProvidedOptions` is spread into the SDK options, and `allowedTools` is not overridden (`dist/acp-agent.js:2523`, `:2554`).
  - Allow rules take `mcp__<server>__*` ([Agent SDK MCP docs](https://code.claude.com/docs/en/agent-sdk/mcp), [permissions docs](https://code.claude.com/docs/en/permissions), fetched 2026-09-28). An allow rule for the bare `mcp__*` is ignored.
- **Codex.**
  - Codex prompts for an MCP call **unless** one of these holds:
    - The tool is annotated `readOnlyHint: true`.
    - It is annotated both `destructiveHint: false` and `openWorldHint: false`.
    - The approval policy is `Never` with full disk write access.
  - Sources: `CX` [`core/src/mcp_tool_call.rs:2096-2113`](https://github.com/openai/codex/blob/f221438b691b8f749d98f22077c93ebe01923fbe/codex-rs/core/src/mcp_tool_call.rs#L2096-L2113), `:1156-1180`, and `codex-mcp/src/mcp/mod.rs:70-89`.
  - The prompt arrives as an MCP elicitation. codex-acp turns it into `session/request_permission` titled "Approve <tool>", with options `approved` (allow_once), possibly `approved-for-session` or `approved-always`, and `cancel` (`CXA` [`src/thread.rs:543-658`](https://github.com/zed-industries/codex-acp/blob/bb590500e8646f6daf879b8b3c6a659fbd29017d/src/thread.rs#L543-L658)).
  - Servers injected over ACP get `default_tools_approval_mode: None` (`codex_agent.rs:382`), so **tool annotations are the only lever.** Annotate read-only tools as `readOnlyHint`, and mark the mutating tools `destructiveHint: false, openWorldHint: false` where that is honest.
- **opencode.**
  - Default permissions are `"*": "allow"`, so MCP tools don't prompt unless the user's config says otherwise (`OC` `agent/agent.ts:119-135`).
  - When it does prompt, the options are `once`, `always` and `reject` (`OC` `acp/permission.ts:21-23`).

### Tool names

| Adapter | Name the model sees | Title the ACP client sees | Source |
|---|---|---|---|
| Claude | `mcp__<server>__<tool>` | the raw tool name | `dist/tools.js:333-338` |
| Codex | `mcp__<server>__<tool>`, sanitized, and cut to fit **64 chars** | `Tool: <server>/<tool>` | `CX` `codex-mcp/src/mcp/mod.rs:44-66`, `codex-mcp/src/tools.rs:260-261`, `:359-380`; `CXA` `src/thread.rs:1751` |
| opencode | `<server>_<tool>`, with characters outside `[A-Za-z0-9_-]` replaced by `_` | not checked | `OC` `mcp/catalog.ts:117-119` |

Keep the server name short and without spaces (`screenplay`). Keep tool names short, lowercase and snake_case so they survive all three.

### Limits and failure modes

- **Codex default tool timeout is 120 s**, and startup is 30 s (`CX` `codex-mcp/src/rmcp_client.rs:76-77`). A "send to a Workspace chat" tool must return once the prompt is queued, not wait for the turn to finish.
- **Claude caps MCP output at 25,000 tokens** by default (`MAX_MCP_OUTPUT_TOKENS`). Its HTTP per-request timer is at least 60 s ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp), fetched 2026-09-28). `read_canvas` should return a compact summary, not raw documents.
- **Failures are silent.** Codex drops SSE entries, opencode swallows `mcp.add` failures, and codex marks ACP servers `required: false` (`codex_agent.rs:368`). A wrong URL or token shows up only as "the tools aren't there". Log the MCP route's `initialize` hits so a missing handshake can be spotted.
- **The adapter process is a fresh process per turn.** The engine opens a session every turn and resumes with `session/load` (`acp-engine.ts:209-243`). The server entry, and therefore the token, is re-sent every turn. Either keep the token stable per chat, or accept a new one per turn. Claude only compares fingerprints inside a single live process, so a per-turn token costs nothing.
- **Codex adds the user's servers too.** A Codex session also loads the MCP servers from the user's `~/.codex/config.toml` (`codex_agent.rs:346`). Claude also loads the user's and project's MCP config through `settingSources` (`dist/acp-agent.js:2552`). Both matter if the coordinator is meant to see only canvas tools.
- **codex-acp is unpinned.** `npx -y @zed-industries/codex-acp` floats (`codex.ts:242`). The SSE drop, the http-only capability and the approval behaviour above are for 0.16.0 and could change. Pinning it, as the Claude adapter is pinned, would make them stable.
- **opencode has no chat adapter yet.** Supporting it means setting `acpAdapter: { command: "opencode", args: ["acp"] }` (`OC` `cli/cmd/acp.ts:9-17`). That is out of scope for MCP, but opencode is not reachable as a coordinator today.

## Answer / recommendation for v1

**Yes: v1 can pass a Screenplay MCP server to every chat-capable harness.**

- **Transport.** Use `type: "http"` (Streamable HTTP), the one transport all three adapters advertise and accept. SSE is dropped by codex. stdio would need a bridge binary.
- **Where it runs.** Serve it from a local-build-only route on the sidecar at `http://127.0.0.1:$PORT/…`, authenticated with a per-coordinator bearer token in `headers` that is bound to the chat and canvas, with `Origin` checked.
- **When to send it.** Pass it on both `session/new` and `session/load`.
- **Permissions.** Pre-allow it for Claude with `_meta.claudeCode.options.allowedTools: ["mcp__screenplay__*"]`, and rely on MCP tool annotations for Codex. Route any remaining `session/request_permission` for these tools away from the plan-approval gate.
- **Working folder.** Give each coordinator a stable, existing, app-owned folder that is not a git repo, created by the app, such as `<app_data_dir>/coordinator/<canvasId>`, instead of today's `/` fallback.
