# How uploaded files can reach an agent, per harness and backend

Research for issue #1504 ("How files can reach agents in each harness"). Researched 2026-10-03 against the adapter versions the repo launches on `origin/main` (`298f848`).

## Question

When a user uploads a file (an image, a PDF, a text file) to a chat, how can it reach the agent? Covered here:

1. Which ACP prompt content blocks (`image`, `resource`, `resource_link`) each adapter accepts, and what it does with them.
2. Whether a file can sit outside the repo checkout, in the hosted Sandbox or on the desktop host, and still be read by the agent.
3. Which file types each harness's model reads natively (images, PDF).
4. Practical size limits.
5. What the blob store (`lib/blob/select.ts`) supports for private, member-checked reads.

## Answer in brief

| Path | Image in the prompt | PDF in the prompt | Text file in the prompt | File on disk, read by the agent |
|---|---|---|---|---|
| Claude Code (`claude-agent-acp@0.54.1`, desktop) | Yes: an `image` block becomes a native image (base64 or http(s) URL) | **No**: a blob `resource` is dropped | Yes: a text `resource` is inlined as `<context>` | Yes. The Read tool returns images and PDFs as content the model sees. Outside `cwd` it needs a permission prompt or `additionalDirectories` |
| Codex (`codex-acp@2.0.1`, desktop) | Yes: becomes a Responses `input_image` | **No, not usefully**: a non-image blob is base64-inlined as *text* | Yes: inlined as `<context>` | Images yes, through `view_image`. Codex has no PDF input type, so a PDF is read only with shell tools such as `pdftotext` |
| OpenCode (`opencode acp`, not wired) | Yes | Yes: a blob `resource`, or a `file://` `resource_link` with `mimeType` | Yes | Yes. Its Read tool attaches images and PDFs. Not reachable today: `acpAdapter: null` |
| Hosted chat (in-process AI SDK engine, not ACP) | Not today: user records go to the model as text | Not today | Not today | The in-process code-read tools read text only |
| Hosted harness in the Sandbox terminal | n/a (interactive CLI) | n/a | n/a | Yes. `sandbox.writeFiles` takes any absolute path, for example `/vercel/uploads/...` beside the `/vercel/sandbox` checkout |

The robust route that works for every harness is to write the file to disk next to the session and send a `resource_link` with a `file://` URI. The agent then reads it with its own tools: Claude Code and OpenCode read images and PDFs natively that way, and Codex reads images. Inline `image` blocks work on all three ACP adapters. Inline PDFs work only on OpenCode. Our client never reads `promptCapabilities` today, so it would have to start doing that before it sends anything beyond text and `resource_link`.

Blob store: the hosted store is **public** (`access: "public"`, `lib/blob/vercel.ts:14`), and Vercel fixes a store's access mode when the store is created. Private reads therefore need a **second, private Vercel Blob store**, read through `get(pathname, { access: "private" })` in a route that runs `openRoomForRoute`. For an external fetcher, use a short-lived presigned GET URL. On desktop, `app/blobs/[...path]/route.ts` serves the local directory with **no auth check at all**, and returns a non-image file as `application/octet-stream`.

## Sources and versions

| Thing | Version the repo pins or launches | Primary source read |
|---|---|---|
| ACP SDK (client) | `@agentclientprotocol/sdk@1.1.0` (`apps/app/package.json:28`) | npm tarball `schema/schema.json` |
| ACP spec | v1 docs | [agent-client-protocol@2bc773b](https://github.com/agentclientprotocol/agent-client-protocol/tree/2bc773bc77d245c72971fbb3263b51484faa9ee3/docs/protocol/v1) (`content.mdx`, `initialization.mdx`) |
| Claude Code adapter | `@agentclientprotocol/claude-agent-acp@0.54.1` (`apps/app/lib/agent/harnesses/claude-code.ts:202`) | npm tarball `dist/acp-agent.js` (bundles `@anthropic-ai/claude-agent-sdk` 0.3.197) |
| Codex adapter | `@agentclientprotocol/codex-acp@2.0.1` (`apps/app/lib/agent/harnesses/codex.ts:241`). It drives `@openai/codex` `^0.159.1` app-server | npm tarball `dist/index.js`; [openai/codex@rust-v0.159.1](https://github.com/openai/codex/tree/rust-v0.159.1/codex-rs) |
| opencode | Not wired for chat: `acpAdapter: null` (`apps/app/lib/agent/harnesses/opencode.ts:266`, `:313`). Latest is `opencode-ai@1.18.34` | [sst/opencode@v1.18.34](https://github.com/sst/opencode/tree/v1.18.34/packages/opencode/src) `acp/`, `session/prompt.ts`, `tool/read.ts`, `provider/transform.ts` |
| Vercel Blob | `@vercel/blob@2.8.0` (resolves from `^2.8.0`) | npm tarball `dist/*.d.ts`; [vercel.com/docs/vercel-blob](https://vercel.com/docs/vercel-blob), [/private-storage](https://vercel.com/docs/vercel-blob/private-storage), [/usage-and-pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) |
| Vercel Sandbox | `@vercel/sandbox@3.5.1` | [SDK reference](https://vercel.com/docs/vercel-sandbox/sdk-reference), [pricing / resource limits](https://vercel.com/docs/sandbox/pricing), [concepts](https://vercel.com/docs/sandbox/concepts) |
| Claude limits | — | [Vision](https://platform.claude.com/docs/en/build-with-claude/vision), [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support), [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference), [Claude Code security](https://code.claude.com/docs/en/security) |
| AI SDK (hosted in-process engine) | `ai@^7.0.124`, `@ai-sdk/anthropic@^4.0.70` | npm tarballs `@ai-sdk/provider-utils@5.0.53` `dist/index.d.ts`, `@ai-sdk/anthropic@4.0.71` `dist/index.js` |

The sandbox's egress proxy blocked the OpenAI docs (`platform.openai.com`, `developers.openai.com`) and `agentclientprotocol.com`. The ACP spec was therefore read from its GitHub source. The OpenAI per-image byte limits below are marked unverified.

Short link prefixes:

- `CAA` = `https://unpkg.com/@agentclientprotocol/claude-agent-acp@0.54.1/`
- `CXA` = `https://unpkg.com/@agentclientprotocol/codex-acp@2.0.1/`
- `CX` = `https://github.com/openai/codex/blob/rust-v0.159.1/codex-rs/`
- `OC` = `https://github.com/sst/opencode/blob/v1.18.34/packages/opencode/src/`
- `ACPD` = `https://github.com/agentclientprotocol/agent-client-protocol/blob/2bc773bc77d245c72971fbb3263b51484faa9ee3/docs/protocol/v1/`

## 1. What the protocol allows

- Baseline: "all Agents **MUST** support `ContentBlock::Text` and `ContentBlock::ResourceLink` in `session/prompt` requests" (`ACPD` `initialization.mdx`, "Prompt capabilities").
- Opt-in: `promptCapabilities.image` allows `image` blocks. `audio` allows `audio` blocks. `embeddedContext` allows `resource` blocks, whose payload is either `{uri, text, mimeType?}` or `{uri, blob (base64), mimeType?}` (`ACPD` `content.mdx`; SDK `schema.json` `PromptCapabilities`, `EmbeddedResource`, `BlobResourceContents`).
- `ImageContent` requires `data` (base64) and `mimeType`. It also has an optional `uri`.
- `ResourceLink` requires `name` and `uri`. It also has optional `mimeType`, `size`, `title` and `description`. The spec's own example is `file:///home/user/document.pdf` with `mimeType: application/pdf` (`ACPD` `content.mdx`, "Resource Link").
- `session/new` takes optional `additionalDirectories`: "Additional workspace roots for this session. Each path must be absolute. These expand the session's filesystem scope without changing `cwd`" (SDK `schema.json` `NewSessionRequest`). An agent advertises support as `sessionCapabilities.additionalDirectories`.

**What our client does today.** `AcpSession.open` sends `clientCapabilities: {}` (`apps/app/lib/agent/acp/session.ts:431`). It sets no `fs` proxy, so the agent cannot read files through the client. It never inspects `init.agentCapabilities.promptCapabilities`. The only non-text block it sends is a `resource_link` with a `mention:` URI for `@`-mentions (`apps/app/lib/agent/acp/markers.ts:53`). The Claude adapter renders that block as a bare link string (see §2).

## 2. Each ACP adapter

### Claude Code: `@agentclientprotocol/claude-agent-acp@0.54.1`

- **Advertises** `promptCapabilities: { image: true, embeddedContext: true }`, and `sessionCapabilities.additionalDirectories: {}` (`CAA` `dist/acp-agent.js:409-412`, `:422`).
- **Conversion** happens in `promptToClaude` (`CAA` `dist/acp-agent.js:3409-3475`):
  - `image` with `data` becomes an Anthropic `image` block with a `base64` source. `image` with an `http…` `uri` and no data becomes an `image` block with a `url` source. ACP's schema makes `data` required, so a URL-only image has to send `data: ""`.
  - `resource` with `text` becomes a link line in the message, plus `<context ref="uri">…text…</context>` appended at the end of the user message.
  - **`resource` with `blob` is ignored.** The code comment reads "Ignore blob resources (unsupported)". A PDF or any binary sent inline is silently dropped.
  - `resource_link` becomes the text `[@name](file://…)` for `file://` and `zed://` URIs, and the raw URI otherwise. The adapter does not read the file. The model sees the path and decides whether to call Read.
  - `audio` and other types are dropped.
- **Reading files on disk.** Claude Code's Read tool returns images "as visual content that Claude can see". It "resizes and recompresses large images to fit the model's image size limits". It reads PDFs natively: "short `.pdf` files whole", and above 10 pages "in ranges with a `pages` parameter … up to 20 pages at a time", which needs `pdftoppm` from poppler-utils ([tools reference, "Read tool behavior"](https://code.claude.com/docs/en/tools-reference)).
- **Outside `cwd`.** "In Manual mode, Claude Code asks you before its file tools read or write outside the folder where it was started and its subfolders" ([security](https://code.claude.com/docs/en/security)). That prompt reaches us as an ACP `requestPermission`, which goes to Screenplay's human approval gate (`session.ts:708`). To read an upload with no prompt, put it under `cwd` or pass its directory in `additionalDirectories`. The adapter forwards `params.additionalDirectories` to the SDK (`CAA` `dist/acp-agent.js:456`, `:2420`).

### Codex: `@agentclientprotocol/codex-acp@2.0.1`

- **Advertises** `promptCapabilities: { embeddedContext: true, image: true }` and `sessionCapabilities.additionalDirectories: {}` (`CXA` `dist/index.js:37319-37344`). The `image: false` objects near line 24043 are the SDK's zod defaults, not the agent's answer.
- **Conversion** happens in `buildPromptItems` (`CXA` `dist/index.js:34381-34414`):
  - `image` becomes a Codex `{type:"image", url}`, using the block's `uri` when it is http(s) or `data:`, and a `data:<mime>;base64,…` URL otherwise.
  - `resource` with `text` becomes text: a link plus `<context ref=…>…</context>`.
  - `resource` with a blob whose `mimeType` is `image/*` becomes an image.
  - **`resource` with any other blob, such as a PDF, becomes text: `<context … encoding="base64">BASE64</context>`.** The model receives raw base64 as text tokens. That is useless for reading and expensive.
  - `resource_link` becomes the text `[@name](uri)`. The adapter does not read it.
  - `audio` is dropped.
- **No PDF input in Codex itself.** Codex's `ContentItem` enum has only `InputText`, `InputImage`, `InputAudio` and `OutputText` (`CX` `protocol/src/models.rs:879-896`). `UserInput` adds `LocalImage { path }` and `LocalAudio`, but there is no file or PDF variant (`CX` `protocol/src/user_input.rs:16-56`). PDFs therefore reach Codex only as text extracted by a shell command.
- **Reading files on disk.** The `view_image` tool resolves a path against the turn's cwd (absolute paths work), reads it through the sandbox, and rejects non-images (`CX` `core/src/tools/handlers/view_image.rs:152-188`). Codex's sandbox policies are `ReadOnly`, and `WorkspaceWrite`, which is "Same as `ReadOnly` but additionally grants write access to the current working directory" (`CX` `protocol/src/protocol.rs:1072-1117`). So Codex can read an upload outside `cwd`. The adapter's default mode is `agent`, which is `workspaceWrite` (`CXA` `dist/index.js:32988-33014`). `additionalDirectories` only adds **writable** roots (`CXA` `dist/index.js:34505-34511`).
- **Image preparation.** Codex resizes prompt images to a maximum dimension of 2048 px. Its byte cap, `MAX_PROMPT_IMAGE_INPUT_BYTES = 1 GiB`, is "a high sanity guard … not a protocol requirement" (`CX` `utils/image/src/lib.rs:24-31`, `:75-76`). The real limit is the OpenAI API's. The OpenAI docs were blocked from this sandbox, so that number is unverified here.

### OpenCode: native `opencode acp` (v1.18.34), not wired

- Screenplay has no adapter for it: both opencode descriptors set `acpAdapter: null` (`apps/app/lib/agent/harnesses/opencode.ts:266`, `:313`). Everything below applies only once it is wired.
- **Advertises** `promptCapabilities: { embeddedContext: true, image: true }` (`OC` `acp/service.ts:120-123`).
- **Conversion** happens in `contentBlockToParts` (`OC` `acp/content.ts:30-118`):
  - `image` (data, `data:` or http(s) URI) becomes a `file` part.
  - A text `resource` becomes text.
  - **A blob `resource` with a `mimeType` becomes a `file` part with a data URL. This path handles PDFs.**
  - A `resource_link` with a `file://` URI becomes a `file` part. The prompt then **reads the file from disk itself**. For `text/plain` it runs the Read tool. For any other mime it attaches the file's bytes as a `data:` URL file part (`OC` `session/prompt.ts:808-967`). This read bypasses the cwd check (`extra: { bypassCwdCheck: true }`, `:822`).
- **Model capability gate.** If the selected model lacks the `image` or `pdf` input modality, the part is replaced with `ERROR: Cannot read … (this model does not support pdf input). Inform the user.` (`OC` `provider/transform.ts:8-15`, `:409-440`).
- **Reading on disk.** The Read tool returns JPEG, PNG, GIF, WebP and PDF files as attachments (`OC` `tool/read.ts:19`, `:303-323`). Text reads are capped at 50 KB per call (`:16`). MCP resource blobs are capped at 10 MB and limited to PDF and the four image types (`OC` `session/prompt.ts:65-72`).

## 3. Backends: where a file can sit

### Desktop local backend (the ACP path)

- The external engine is used only when `AGENT_ENGINE=external`. On the hosted default, `resolveLiveEngine` returns `inProcessEngine` (`apps/app/lib/agent/acp/resolve-live-engine.ts:135`).
- `cwd` is the Branch's host worktree (`:146`; `lib/sandbox/local/provider.ts:437`). For the Coordinator and Sketch chats it is `~/.screenplay/coordinator/<room>` (`lib/agent/coordinator-mcp.ts:150`). The sandbox "home" is the host `$HOME` (`provider.ts:442`).
- `writeFiles` resolves relative paths against the worktree, writes absolute paths as given, and creates parent directories (`provider.ts:461-469`). Any host path works, for example `~/.screenplay/uploads/<room>/<id>/<name>`. Keeping uploads out of the worktree keeps them out of `git status`.
- With the upload outside `cwd`, Codex reads it freely. Claude Code needs the upload's directory in `additionalDirectories`, or else it prompts. OpenCode reads a `resource_link` it was sent regardless of cwd.

### Hosted Vercel Sandbox

- Layout: the checkout is at `/vercel/sandbox`, and the unprivileged user's home is `/vercel` (`lib/sandbox/vercel.ts:37-38`). On sandboxes created before #1388, the home is `/home/vercel-sandbox` (`:45-46`).
- `sandbox.writeFiles()`: "Paths default to `/vercel/sandbox`; use absolute paths for custom locations". It takes `{ path, content: Buffer, mode? }` ([SDK reference](https://vercel.com/docs/vercel-sandbox/sdk-reference)). `/vercel/uploads/…` is therefore writable and outside the repo. `sandbox.mkDir()` is available too.
- Disk: "Each sandbox created with Sandbox SDK 3.0.0 or above, or from a custom image, is automatically provisioned 64 GB of ephemeral NVMe storage" ([pricing, resource limits](https://vercel.com/docs/sandbox/pricing)). Persistent sandboxes snapshot the filesystem on stop ([concepts](https://vercel.com/docs/sandbox/concepts)), so uploads survive a hibernate and resume.
- **Who reads it on hosted.** Hosted chat runs the in-process AI SDK engine, not a harness. Harnesses on hosted run only as an interactive CLI in the terminal tab, and there a file in `/vercel/uploads` is just a file the user can point the CLI at. The in-process engine currently flattens every user record to a text string (`lib/agent/acp/adapter.ts:127`). The AI SDK supports `image` and `file` parts: `FilePart` accepts data, URL or a provider reference (`@ai-sdk/provider-utils` `dist/index.d.ts:195-245`). `@ai-sdk/anthropic` maps image, `application/pdf` and `text/plain` file parts to native blocks, and throws `UnsupportedFunctionalityError` on other media types (`dist/index.js:2415-2465`). Hosted support would therefore mean sending those parts from the user record, not writing to disk.

## 4. Native file types and size limits

| Harness and model | Images | PDF | Limits that matter |
|---|---|---|---|
| Claude (Claude Code adapter, AI SDK Anthropic) | JPEG, PNG, GIF, WebP | Yes, natively (text plus page images) | Image: 10 MB base64 per image on the direct API (5 MB on Bedrock and Vertex), 8000×8000 px maximum, 2000 px maximum when a request has more than 20 images, downscaled past 1568 px (2576 px on 4.7+). Request: 32 MB. PDF: 600 pages (100 under a 1M-token context) ([vision](https://platform.claude.com/docs/en/build-with-claude/vision), [PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support)). Claude Code Read: PDFs over 10 pages read 20 pages at a time |
| Codex (OpenAI models) | Yes (`input_image`), resized to 2048 px | **No input type**: shell extraction only | OpenAI byte limits unverified (docs blocked) |
| OpenCode | Per model `modalities.input` | Per model (`pdf` modality) | Read: 50 KB of text per call. MCP blobs: 10 MB |

Practical guidance: inline base64 travels inside one ACP JSON-RPC line on the adapter's stdio, and Claude's 32 MB request cap applies to the whole request, history included. Keep inline images to a few MB. Send larger files, and every PDF, by path.

## 5. The blob store and private, member-checked reads

**Today:**

- `selectBlobStore` picks `vercel` (default) or `local-fs` by `BLOB_STORE` (`lib/blob/select.ts`). The interface is `put` only, and returns a "public URL" (`lib/blob/types.ts`).
- Vercel: `put(key, …, { access: "public", addRandomSuffix: true })` (`lib/blob/vercel.ts:14`). Anyone with the URL can read the blob.
- Desktop: files go under `LOCAL_BLOB_DIR` (default `.screenplay/blobs`, `lib/blob/local-fs.ts:7`) and are served by `app/blobs/[...path]/route.ts`. That route is local-build only (`:40`). It guards path traversal but **checks no session or membership**. It knows only image content types and serves everything else as `application/octet-stream` (`:27`, `:64`), with `cache-control: public, max-age=60` (`:76`).

**What Vercel Blob offers (`@vercel/blob@2.8.0`):**

- A store is either private or public: "you cannot change it after the creation of a blob store" ([Vercel Blob](https://vercel.com/docs/vercel-blob), "Private and public storage"). Private needs `@vercel/blob` 2.3 or later. 2.8.0 qualifies. Uploads therefore need a **separate private store**. The current thumbnail store cannot be flipped to private.
- Private read access is "Authenticated (token required)", and delivery is "Through your Functions via `get()`". A private URL `https://<store-id>.private.blob.vercel-storage.com/<pathname>` "is not publicly accessible" ([private storage](https://vercel.com/docs/vercel-blob/private-storage)).
- `get(urlOrPathname, { access: "private", useCache?, ifNoneMatch? })` returns `{ statusCode: 200, stream, blob: { contentType, size, … } }`, a 304, or `null` (`dist/index.d.ts:131-228`). Vercel's recommended pattern is a route that authenticates the caller and then streams `get()`, with `Cache-Control: private, no-cache` (or `no-store` for sensitive data) and `X-Content-Type-Options: nosniff`. For us, the authentication step is `openRoomForRoute(roomId, chatId)` (`lib/room-access.ts:95`), which returns 401 or 403 for a non-member.
- **Presigned URLs** are for handing a file to something outside our auth, such as the Anthropic API's `url` image source, or a sandbox `curl`. `issueSignedToken({ pathname, operations: ["get"], validUntil })` (server only; default lifetime one hour) plus `presignUrl(token, { operation: "get", pathname })` yields a time-limited GET URL (`dist/create-folder-*.d.ts:314-372`, `:375-450`).
- Limits: 5 TB per file, multipart above 100 MB. Blobs over 512 MB are never cached ([usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)). Server uploads through a Function are capped at the 4.5 MB request body, so larger files need client uploads (`handleUpload`, or the presigned `put`) ([server upload](https://vercel.com/docs/vercel-blob/server-upload)).

**Desktop.** A private read would be a membership check added to the `/blobs` route, or a separate uploads route, plus real content types. Because the agent runs on the same host, the simplest hand-off is to write the upload under an app-owned uploads directory and give the agent the path. No HTTP fetch is needed.

## Implications for a design (not decisions)

1. **One portable mechanism:** write the upload to disk beside the session (desktop: an app-owned host directory; hosted Sandbox: `/vercel/uploads/...`), then send a `resource_link` with a `file://` URI, `mimeType` and `size`. All three adapters must accept it. Claude Code and OpenCode will read images and PDFs natively, and Codex reads images through `view_image`. Add the directory to `additionalDirectories` for Claude Code.
2. **Inline blocks as an optimisation:** an `image` block works on all three adapters. Only OpenCode accepts an inline PDF. Codex turns one into base64 text, and Claude drops it. Gate inline blocks on `promptCapabilities`, which the client must start reading.
3. **Persistence:** a user record carrying inline `image` data would be written to Postgres and the chat broadcast. `lib/agent/image-output.ts` already avoids this for tool screenshots by keeping only a caption. A path or `resource_link` keeps the transcript small. Fresh-session replay flattens earlier turns to text (`lib/agent/acp/acp-engine.ts:423`), so attachments from earlier turns survive only as links.
4. **Hosted chat** needs the in-process engine to emit AI SDK `image` and `file` parts from user records. That is separate from the ACP work.
5. **Storage:** add a private Vercel Blob store for uploads, served through a member-checked route. The thumbnail store stays public.
