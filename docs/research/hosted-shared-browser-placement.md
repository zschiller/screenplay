# Where should a hosted frame's shared browser run?

Research for issue #1365 (under map #1364, "Live frames people and agents drive together"). Researched 2026-10-02.

## Question

A live frame is one shared browser per frame: headful Chromium on an Xvfb display, grabbed and encoded once by ffmpeg (H.264), and sent to every viewer over a WebSocket. Input goes in over CDP. On the hosted backend, where should that stack run?

- **A. Co-located:** inside the frame's Workspace Sandbox, next to the dev server, the bridge proxy, ttyd and the agent harness. The browser loads the dev server on `localhost`.
- **B. Separate:** one browser Sandbox per canvas, running every live frame on that canvas. Each browser loads its Workspace's public preview URL (`https://sb-*.vercel.run`).

## Labels

- **checked**: read in a primary source (Vercel docs or changelog, the pinned SDK's published typings, or this repo's code), cited inline.
- **inferred**: follows from checked facts, but nobody has run it.
- **unverified**: plausible, but not confirmed by a source or a run.

## Sources

| Source | What it covers |
|---|---|
| [Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing) (updated 2026-09-10) | rates, vCPU sizes, memory per vCPU, ports, session limits |
| [Understanding Sandboxes](https://vercel.com/docs/sandbox/concepts) (2026-08-25) | Firecracker microVM, root access, lifecycle |
| [Images](https://vercel.com/docs/sandbox/concepts/images) (2026-08-11) | managed images, custom VCR images |
| [Persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) (2026-09-15) and [Snapshots](https://vercel.com/docs/sandbox/concepts/snapshots) (2026-08-26) | what survives a stop |
| [Regions](https://vercel.com/docs/sandbox/concepts/regions) (2026-09-22) | 19 regions, default `iad1` |
| [JS SDK reference](https://vercel.com/docs/sandbox/sdk-reference) | `ports`, `domain()`, `resources`, `image`, `runtime` |
| [Install system packages (KB)](https://vercel.com/kb/guide/how-to-install-system-packages-in-vercel-sandbox) | apt on Ubuntu images, dnf on legacy Amazon Linux 2023 |
| [Changelog: concurrency and port limits](https://vercel.com/changelog/vercel-sandbox-increases-concurrency-and-port-limits) (2025-08-18) and [custom images](https://vercel.com/changelog/vercel-sandbox-now-support-custom-images) (2026-06-30) | history of the port limit and images |
| `@vercel/sandbox@2.0.0-beta.14` (`dist/sandbox.d.ts`, from the npm tarball). This is the version `pnpm-lock.yaml` resolves for `^2.0.0-beta.13` | what the repo's SDK actually accepts |
| Repo: `apps/app/lib/sandbox/provision-internals.ts`, `provisioning.ts`, `lifecycle.ts`, `vercel.ts`, `provision.ts`, `network-policy.ts`, `terminal.ts` | how Workspace sandboxes are created today |
| Repo: `apps/app/lib/live-frame/webrtc.prototype/results.md` (this branch) | per-frame CPU and memory |

## How Workspace sandboxes are created today (checked, repo)

- `provisioning.ts:292-301` calls `sandboxProvider.create` with `ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT]` (dev server, bridge proxy at +1000, ttyd at 7681), `timeout: SANDBOX_TIMEOUT`, `snapshotExpiration: SNAPSHOT_EXPIRATION` and `resources: { vcpus: SANDBOX_VCPUS }`.
- `provision-internals.ts:9-13` sets `SANDBOX_TIMEOUT = 30 min`, `SNAPSHOT_EXPIRATION = 24 h` and `SANDBOX_VCPUS = 1` ("1 vCPU = 2048 MB memory, sufficient for a Node.js dev server").
- No `image` or `runtime` is passed. The pinned SDK's typings say "If not specified, the default runtime `node24` will be used". That is a legacy runtime image, and `provision.ts:100-121` already allows for Amazon Linux (`dnf`/`yum`) next to Debian (`apt`).
- `lifecycle.ts:327-357` (`keepAliveSandbox`): while a user has the page open, a heartbeat calls `extendTimeout(SANDBOX_TIMEOUT)`. It never wakes a stopped VM.
- `lifecycle.ts:441-521` (restart): calls `snapshot()`, which stops the VM, then boots a new VM from that snapshot and relaunches the dev server.
- `terminal.ts` and `terminal-access.ts` already serve ttyd's PTY over a WebSocket on `sandbox.domain(TERMINAL_PORT)`, authenticated on the WebSocket upgrade. So a WebSocket through `sb-*.vercel.run` works in production today.
- `network-policy.ts:19-29` allows all egress (`"*": []`) and adds header-injection rules only for model providers.

## Findings

### 1. Sizes, pricing and limits

All of these are **checked** against [pricing](https://vercel.com/docs/sandbox/pricing) unless marked otherwise.

- **vCPUs:** 1, or an even number from 2 up to the plan maximum: Hobby 4, Pro 8, Enterprise 32. The default is 2.
- **Memory:** each vCPU includes 2 GB. Memory isn't sized on its own (the SDK typings say "2048 MB of memory per vCPU"). The plan maximums are 8, 16 and 64 GB.
- **Pro rates (`iad1`):**
  - Active CPU: $0.128 per vCPU-hour. Only time the code actually uses the CPU counts; I/O waits are free.
  - Provisioned memory: $0.0212 per GB-hour, billed for the whole time the sandbox runs, in 1-minute minimums.
  - Creations: $0.60 per million.
  - Snapshot storage: $0.08 per GB-month.
  - Data transfer: included in the Flat Rate CDN on Pro, and $0.15/GB on Enterprise. All traffic to and from exposed ports is billable. Downloads into the sandbox are free.
- **Sessions:** at most 45 minutes on Hobby and 24 hours on Pro or Enterprise. The limit applies per session, and a resume starts a new session.
- **Concurrency:** 10 sandboxes on Hobby, 10,000 on Pro.
- **Ports:** the current docs say up to 15 open ports on every plan. But the SDK the repo pins (`2.0.0-beta.14`) documents `ports` as "Sandboxes can expose up to 4 ports", and the [2025-08-18 changelog](https://vercel.com/changelog/vercel-sandbox-increases-concurrency-and-port-limits) also says 4. **Unverified:** whether the 15-port limit applies to sandboxes created with the pinned SDK. Plan on 4 until the SDK is upgraded. Workspaces use 3 today.

### 2. Can Xvfb, headful Chromium and ffmpeg run there?

- **checked:** each sandbox is a Firecracker microVM with its own kernel and full root (`sudo: true`). It can run privileged workloads such as Docker and FUSE ([concepts](https://vercel.com/docs/sandbox/concepts)). Nothing in the docs rules out an X server or a GPU-less Chromium.
- **checked:** the current default image is `vercel/sandbox/universal`, which is Ubuntu 26.04 with apt. Custom OCI images from the Vercel Container Registry boot directly ([images](https://vercel.com/docs/sandbox/concepts/images)). The image's Docker `ENTRYPOINT` and `CMD` are not run, so processes are started with `runCommand`.
- **checked:** the repo's Workspaces boot the legacy `node24` runtime image. That is Amazon Linux 2023 with dnf (the [KB](https://vercel.com/kb/guide/how-to-install-system-packages-in-vercel-sandbox) labels it "Amazon Linux 2023 (legacy)").
- **unverified:** Amazon Linux 2023's repositories don't ship Chromium or ffmpeg, and there is no EPEL for AL2023, so neither installs with a plain `dnf install`. Xvfb (`xorg-x11-server-Xvfb`) is probably there. The workarounds would be a static ffmpeg build plus Playwright's bundled Chromium, with its shared libraries installed by hand.
- **inferred:** on Ubuntu (the managed `ubuntu` or `universal` images, or a custom image) it is all ordinary apt packages: `xvfb`, `ffmpeg` with libx264, and Chromium (via Playwright or Google's `.deb`, because Ubuntu's `chromium` is a snap). Baking them into a custom VCR image avoids an install that would take minutes at provision time.
- **Not run on a real Sandbox.** The prototype ran in a plain Linux container (results.md, "Not measured"). The first real run is the cheap way to settle this for both options.

This item favours **B**. A separate browser sandbox can boot a purpose-built VCR image today and leave Workspace provisioning alone. Option A needs the Workspace image to carry the browser stack. That means either moving Workspaces to SDK 3 with an Ubuntu or custom image, or an awkward install on AL2023 that is then kept by snapshots, at roughly 0.5 GB extra per Workspace snapshot, or about $0.04 per month.

### 3. Port exposure

- **checked:** `sandbox.domain(port)` returns `https://<subdomain>.vercel.run` (SDK typings). Only HTTPS is exposed. The repo's ttyd terminal shows that WebSocket upgrades pass through.
- **inferred:** WebRTC over UDP isn't possible without a TURN relay. That matches the prototype's choice of H.264 over a WebSocket.
- **A** needs one more port for the stream server. That fits within 4 (dev, proxy, ttyd, stream) if a single WebSocket server carries every frame in the Workspace, picking the frame by path or query string. It leaves no spare port until the SDK upgrade.
- **B** has its own port budget, with one port for the stream server and room to spare.

### 4. The extra network hop (option B)

- **inferred:** in B, every request the page makes leaves the browser sandbox, goes through Vercel's public `sb-*.vercel.run` routing over TLS, and enters the Workspace sandbox's bridge proxy. That covers documents, JS chunks, the HMR WebSocket and API calls. In A, they go to `localhost`.
- **unverified:** the cost of that hop. If both sandboxes are in the same region (the default is `iad1` for both), it is probably a few milliseconds to a few tens of milliseconds per request, plus a TLS handshake per connection. Nobody has measured it.
- **inferred:** the hop does **not** affect input to picture, which is the latency results.md measured (about 40 ms locally and 120 ms at an 80 ms round trip). Input and capture both stay inside the browser sandbox. The hop only slows page loads, HMR updates and data fetches. Dev-mode pages make many requests, so a cold page load in B is noticeably slower than over localhost.
- **checked:** traffic to and from exposed ports is billable. In B, the Workspace's preview port also carries the browser's page traffic. That is free on Pro (Flat Rate CDN) and $0.15/GB on Enterprise. Either way it is small next to the video.

### 5. Hibernation and snapshots versus a live browser

- **checked:** stopping a sandbox snapshots only the **filesystem**. A timeout, `stop()` or `snapshot()` all end the session, and a resume boots a new VM from the snapshot ([persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes), [snapshots](https://vercel.com/docs/sandbox/concepts/snapshots): "Once you create a snapshot, the sandbox shuts down automatically"). Nothing in the docs describes snapshotting memory or processes.
- **inferred:** a stop therefore kills Xvfb, Chromium and ffmpeg. Everything in memory is lost: the DOM, JavaScript state, scroll position, unsaved form input, and session cookies that hadn't been flushed. Whatever the Chromium profile already wrote to disk survives (for example, persisted cookies and localStorage), if the profile is kept on disk. On resume, a hook (the repo's relaunch path, or `onResume`) has to start the stack again and reload the frame's URL. No backend can keep a live browser alive across hibernation, so the product should treat a hibernated frame as "reload on wake".
- **checked:** sessions are capped at 24 hours on Pro, which forces at least one such reload a day. The repo's "Restart" (`lifecycle.ts:441`) also snapshots and replaces the VM.
- **A:** the browser shares the Workspace's lifecycle. A frame can't outlive its dev server anyway, so this costs nothing. The existing keep-alive heartbeat just needs to fire while anyone is watching a frame from that Workspace, not only when its Workspace page is open.
- **B:** there are two lifecycles to coordinate. The canvas sandbox needs its own keep-alive, and it must also keep every Workspace its frames point at alive. If not, a Workspace sleeps after 30 minutes and the frame shows the bridge proxy's placeholder or a network error. It is more moving parts, but nothing new in kind.

### 6. Cost per live frame (Pro, `iad1`, prototype numbers)

From results.md (2 cores, H.264, 1280×800):
- The first frame's stack (Xvfb, Chromium, ffmpeg and the server) is about 0.50 GB.
- Each extra frame adds about 190 MB.
- Each frame takes about 35% of a core at 30 fps, or 65% at 60 fps, **even when the page is still**. x11grab encodes every frame, so Active-CPU billing saves nothing until an idle mode exists.

CPU per frame-hour: 0.35 × $0.128 = **$0.045** at 30 fps, and 0.65 × $0.128 = **$0.083** at 60 fps. This is the same in A and B (inferred).

| | A: co-located | B: separate per canvas |
|---|---|---|
| Fixed cost to go live | Workspace goes from 1 to 2 vCPU: +2 GB × $0.0212 = **+$0.042/h**, for as long as that Workspace runs | New 2-vCPU, 4 GB sandbox: **$0.085/h** per canvas with live frames, plus one creation (negligible) |
| 1 live frame | $0.042 + $0.045–0.083 = **$0.09–0.13/h** | $0.085 + $0.045–0.083 = **$0.13–0.17/h** |
| 2 live frames, same Workspace / same canvas | $0.042 + 2 × (0.045–0.083) = $0.13–0.21/h, or **$0.066–0.104 per frame** | $0.085 + 2 × (0.045–0.083) = $0.18–0.25/h, or **$0.087–0.125 per frame** |
| 2 live frames, two Workspaces | Each Workspace pays its own +$0.042: **$0.09–0.13 per frame** | One canvas sandbox: **$0.087–0.125 per frame** |
| Video egress (both) | 0.2 Mbps still ≈ 0.09 GB/h, 3 Mbps busy ≈ 1.35 GB/h, per viewer. Free on Pro, $0.01–0.20/h per viewer on Enterprise | same |

(inferred, from checked rates. The CPU share comes from the prototype, not from a Sandbox run.)

- The two options cost about the same, roughly **10 to 15 cents per live frame-hour**. A is cheaper for a frame or two per Workspace. B only catches up when one canvas has live frames from many Workspaces, because it pays for the browser memory once.
- Viewers don't change the compute cost, because the stream is encoded once per frame.
- **Capacity:** results.md says a 2-vCPU sandbox carries about two frames at 60 fps with nothing else running. In A, the dev server and agent share those cores, so 2 vCPU realistically means **one 60 fps frame, or two at 30 fps**. More needs 4 vCPU, at +$0.085/h of memory. In B, 2 vCPU carries two frames at 60 fps, and Pro's maximum of 8 vCPU carries about eight. More than that needs a second browser sandbox.
- **unverified:** whether `sandbox.update({ resources })` resizes a running session or takes effect only on the next one. If only on the next one, A can't add vCPUs at the moment a frame goes live without restarting the Workspace. In that case, hosted Workspaces should just be provisioned at 2 vCPU, which costs $0.042/h on every running Workspace, live frame or not.

### 7. Other differences

- **CPU contention (inferred):** in A, a Next.js dev compile, `npm install` or a test run started by the agent shares the cores with the encoder. The prototype showed what happens on saturated cores: a 60 ms p99 frame gap and 180 ms busy-page latency. The stream would stutter at exactly the moment people are watching a change land. B keeps the encoder on its own cores. The page still waits for the compile, but the video around it stays smooth.
- **Agent access:** in A, the agent harness reaches the browser's CDP and the control gate over `localhost` with no new credentials. In B, the agent calls the browser sandbox over HTTPS. The prototype's agent already uses an HTTP gate, so this works, but it needs a minted credential, like ttyd's (`terminal-access.ts`).
- **Blast radius:** in A, the browser runs inside the untrusted Workspace VM. The agent and user code can reach it and tamper with it, but it only ever shows that Workspace, so nothing is lost. B puts several Workspaces' frames in one VM. It is still one Chromium per frame, but it is a shared VM, so a bug in the stream server could cross Workspaces.
- **Code to write:** A extends what exists (one more port, one more relaunch step, a bigger `SANDBOX_VCPUS`). B adds a new kind of sandbox with its own provisioning, image, keep-alive, naming and cleanup. It is per canvas, and canvases aren't sandboxed today.

## Recommendation

**Co-locate: run each frame's shared browser inside its Workspace's Sandbox (option A).** Keep a separate browser sandbox as the fallback if real measurements show contention.

Why:
- The cost per live frame is about the same, and A is a little cheaper at one or two frames per Workspace.
- A frame can never outlive its Workspace's dev server, so tying the browser to the Workspace's lifecycle adds nothing. B has to keep two sets of sandboxes alive in step.
- A loads pages over `localhost` with no extra hop. The agent drives the browser locally. It reuses the existing port, keep-alive and relaunch machinery instead of adding a new sandbox type per canvas.

What A needs, in order:
1. **Image:** put Xvfb, Chromium and ffmpeg (libx264) in the Workspace image. The clean route is moving Workspaces off the legacy `node24` runtime (Amazon Linux) to SDK 3 with a custom VCR image built on `vercel/sandbox/ubuntu`. That also lifts the port limit from 4 to 15. Installing on demand on AL2023 is the unverified fallback.
2. **Size:** hosted Workspaces get 2 vCPU (`SANDBOX_VCPUS`) and allow one live frame at 60 fps, or two at 30 fps. Allow 4 vCPU for more. Check whether `sandbox.update({ resources })` applies to a live session.
3. **Ports and lifecycle:** add one stream port that carries every frame in the Workspace. Relaunch the stack wherever the dev server is relaunched (resume and restart), and reload the frame's URL on wake. Fire the keep-alive while anyone watches a frame, not only while the Workspace page is open.
4. **Idle mode:** build the idle mode results.md describes, so still frames cost almost nothing. It is the biggest saving in either option.
5. **First real run:** measure the first frame on a real Sandbox, with encoder fps while the dev server compiles and an agent runs `npm install`. **Switch to B (a separate 2–8 vCPU browser sandbox per canvas, built from its own image)** if 60 fps can't hold through those spikes, or if canvases routinely show live frames from many Workspaces at once.
