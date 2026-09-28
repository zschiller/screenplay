# Streaming one live Chromium tab, with input, to everyone in a Room

Research for issue #980. Feeds the streamed-frame prototype (#983). Researched 2026-09-28.

## Question

Screenplay's canvas shows each frame as an iframe of a prototype's dev server, so today every viewer runs their own copy of the app. The goal is for everyone in a Room to look at, and take turns driving, **one** live instance of a frame. One person drives at a time (handoff like Zoom screen share), so several people typing at once is a nice-to-have.

For each way of running one Chromium tab and streaming it with input to several viewers, this note covers:

- input latency
- memory and CPU per tab
- price
- image quality when the canvas zooms

It also asks whether each option runs:

- **(a)** on a Mac next to the Tauri desktop app
- **(b)** inside a Vercel Sandbox VM

## How to read the claims

- A claim with a link was checked against that source on 2026-09-28.
- **(inferred)** means reasoned from the cited facts, not stated by a source.
- **(unverified)** means from background knowledge, not checked against a source this session. Web fetching was cut short partway through, so the latency and resource numbers carry this label more often than the rest. Check them in the #983 prototype before relying on them.

## Recommendation for #983

**Use one code path on both backends: headless Chrome driven over CDP, `Page.startScreencast` for pixels, and `Input.dispatch*` for input.** Put a small relay in front of the browser that fans the frames out to viewers over a WebSocket and accepts input only from the current driver.

| Where | Browser | Transport to viewers | Why |
|---|---|---|---|
| **Mac (desktop)** | Chrome for Testing (or system Chrome with a dedicated `--user-data-dir`), launched headless by the Tauri sidecar with `--remote-debugging-port` | The sidecar reads CDP, then relays over the Room's existing channel or a sidecar WebSocket | Free; no VM needed; loads `*.localhost` portless routes directly; the page's `deviceScaleFactor` can follow the canvas zoom |
| **Hosted (Vercel Sandbox)** | Headless Chrome installed in the Branch's Sandbox, pointed at `localhost:<devport>` | Exposed Sandbox port carrying a WebSocket, the same way ttyd already works on port 7681 | Same code as Mac. No UDP or TURN needed. About $0.2/hr at 2 vCPU (inferred) |
| **Fallback if CDP screencast feels too laggy** | Hyperbeam, pointed at the Sandbox's public `sb-*.vercel.run` URL | Hyperbeam's own WebRTC and embed | Has a driver-handoff role model built in. $0.007 per participant-minute. Cannot follow zoom DPR; cannot reach a Mac's localhost without a tunnel |

Why not the others:

- **neko** (WebRTC) has the best built-in control handoff. But it needs UDP, or a raw TCP mux port, that the Sandbox can't expose (inferred), plus an X server and GStreamer. It also asks for 4 or more cores per stream.
- **Browserbase and Steel** are built for automation. Their live views are debugger iframes with no per-user control roles.
- **WKWebView snapshotting** has no push stream and no way to inject input.

## Option by option

### 1. CDP `Page.startScreencast` plus `Input.*` (build it yourself)

**What it is.** Chrome pushes a compressed image each time the page repaints. We relay each one to viewers and send input back through the Input domain.

**The API.** Source: [`browser_protocol.json`, ToT](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json), also rendered at [chromedevtools.github.io/devtools-protocol/tot/Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/).

- `Page.startScreencast` is marked **experimental**. Its parameters:
  - `format`: `jpeg` or `png`
  - `quality`: 0–100
  - `maxWidth` and `maxHeight`
  - `everyNthFrame`
  - `maxFramesInFlight`: "Maximum number of frames sent until screencastFrameAck is required. Defaults to 3."
  - `sendLastFrame`
- Each `Page.screencastFrame` event carries:
  - base64 image `data`
  - a `sessionId` (the frame number) that must be sent back with `Page.screencastFrameAck`
  - `metadata`: `offsetTop`, `pageScaleFactor`, `deviceWidth`/`deviceHeight` (DIP), `scrollOffsetX/Y`, `timestamp`
- Input goes through these methods:
  - `Input.dispatchMouseEvent`: `mousePressed`/`Released`/`Moved`/`Wheel`, with x and y in CSS pixels relative to the main frame's viewport, `modifiers`, `button`, `clickCount`, `deltaX/Y`, `pointerType` mouse or pen
  - `Input.dispatchKeyEvent`: `keyDown`/`keyUp`/`rawKeyDown`/`char`, with `key`, `code`, `text`, `commands`
  - `Input.insertText` and `Input.imeSetComposition` (both experimental), for IME and emoji
  - `Input.dispatchDragEvent` (experimental)

  The mouse and key events are stable, not experimental.

**Image quality when the canvas zooms.** This is the strongest of all the options.

- `Emulation.setDeviceMetricsOverride` takes `width`, `height`, and `deviceScaleFactor` separately.
- So the CSS viewport can stay at the frame's size, for example 1280×800, while Chrome rasterizes at 2× or 3×.
- When a viewer zooms the canvas, the relay can raise `deviceScaleFactor` to about `canvasZoom × viewerDPR` (capped) and set `maxWidth`/`maxHeight` to match. The page's layout doesn't change, only its sharpness (inferred from the parameter split).
- The page will see `devicePixelRatio` change and re-fire `resolution` media queries (inferred).
- With several viewers at different zooms, pick the largest requested scale and let the other clients downscale. There is one stream per tab.

**Latency.** No primary source gives numbers.

- Frames are ack-gated (`maxFramesInFlight` defaults to 3), so a slow viewer throttles only the relay, not Chrome, as long as the relay acks as soon as a frame arrives (inferred).
- Frames arrive only when the page repaints, so an idle page costs almost nothing.
- JPEG plus base64 plus WebSocket adds encode and decode time, and there is no inter-frame compression. Expect roughly 30–100 ms from input to picture on the same machine or LAN, plus the network round trip for remote viewers. Expect it to feel worse than WebRTC during scrolling and animation (unverified; measure in #983).
- Input takes one WebSocket hop to the relay, then one CDP call.

**CPU and memory.**

- One headless Chrome with one tab is roughly 150–400 MB of RAM, depending on the app (unverified).
- JPEG encoding happens inside Chrome, costs CPU in proportion to repaint rate × pixel area, and scales with `deviceScaleFactor²` (inferred).
- There is no X server, GStreamer, or video encoder, which makes this much lighter than neko or Kasm (inferred from their stated requirements below).

**Multi-user input.** CDP accepts input from anyone holding the socket. Our relay decides who the driver is. That is exactly the handoff model we want, and letting several people type at once is only a policy change.

**Price.** Free. On hosted it costs whatever the Sandbox costs (see (b)).

**(a) Mac.**

- Chrome 136+ ignores `--remote-debugging-port` and `--remote-debugging-pipe` against the **default** profile. It needs `--user-data-dir` pointing to a non-default directory. Chrome for Testing keeps the old behavior and "is recommended for browser automation" ([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)).
- So the sidecar should launch its own profile, headless. Headless also means no window pops up (inferred).
- The browser runs on the Mac, so it can load the `<branch>.<app>.localhost` portless routes the desktop already uses (see `apps/app/CONTEXT.md`, Dev Server Port).
- Remote viewers still need the frames relayed off the Mac through whatever carries the Room's realtime state (inferred).

**(b) Vercel Sandbox.** It works; see the Vercel section below.

### 2. neko (self-hosted WebRTC virtual browser)

**What it is.** A browser or desktop in Docker: an X server, xdotool/XTEST input, GStreamer encoding, and WebRTC to many viewers. Source: [m1k1o/neko README](https://github.com/m1k1o/neko), docs in the repo at `webpage/docs` (commit `3f4f940`, 2026-09-27).

**Control model.** This is the best fit of any option for Zoom-style handoff.

- The API has `control/request`, `control/give`, `control/take`, `control/release`, and `control/reset` endpoints.
- Session settings include `locked_controls`, `control_protection` (users can take control only if an admin is present), and `implicit_hosting` (clicking the screen takes control) (`webpage/docs/api/control-*.api.mdx`, `webpage/docs/configuration/README.md`).

**Transport.**

- WebRTC needs a UDP port range (`NEKO_WEBRTC_EPR`, for example `56000-56100/udp`) or one UDP/TCP mux port (`webrtc.udpmux`/`tcpmux`, for example 59000). A client that can't connect directly needs a TURN server (`webpage/docs/installation/README.md`, `configuration/webrtc.md`, `installation/examples.md`).
- The only fallback is "Screencast": JPEGs over HTTP, which the docs say "should not be used as a primary video stream because of the high latency, low quality, and high bandwidth requirements" (`configuration/capture.md`).
- Codecs are vp8, vp9, av1, h264, and h265.

**CPU and memory.**

- The docs recommend 4 cores and 3 GB of RAM for "Good Performance" at 1280×720@30. 6 cores and 4 GB is the "Recommended" setting, and 2 cores with 2 GB at 1024×576 is "Not Recommended" (`webpage/docs/quick-start.md`).
- Chromium images need `--shm-size=2g` (`installation/docker-images.md`).

**Latency.** WebRTC video is typically well under 100 ms end to end on a good network (unverified). neko publishes no latency figure.

**Zoom quality.**

- Resolution is the X screen, `desktop.screen` (default `1280x720@30`), which the admin can change in the GUI (`configuration/desktop.md`).
- There is no documented device-pixel-ratio setting. A higher resolution also widens the CSS viewport, so zooming either blurs or relays out the page (inferred).
- Chromium's `--force-device-scale-factor` could decouple the two (unverified).

**Price.** Free and open source (license unverified). The cost is the host it runs on.

**(a) Mac.**

- Chromium images are published for arm64 (`installation/docker-images.md`, architecture table).
- On macOS the container runs in a Linux VM (Docker Desktop or OrbStack) (unverified). The browser inside it can't reach the host's `*.localhost` routes without `host.docker.internal` rewriting (inferred).
- This is heavy to ship next to a desktop app.

**(b) Vercel Sandbox.** Poor fit (inferred).

- Exposed ports are served as HTTPS URLs on `sb-*.vercel.run` ([Vercel changelog](https://vercel.com/changelog/vercel-sandbox-increases-concurrency-and-port-limits)). Nothing documents raw UDP or TCP ingress, so the UDP range and TCP mux paths are both out.
- It would need an external TURN server reachable over TLS on 443, plus running Docker or neko's X and GStreamer stack in the VM. Docker inside the Sandbox is supported ([Runtimes](https://vercel.com/docs/sandbox/concepts/runtimes)).
- It would need 4 or more vCPUs, which is 8 GB at 2 GB per vCPU.

### 3. Hyperbeam (hosted multiplayer browser)

**What it is.** A hosted Chromium streamed over WebRTC into an embeddable client, built for multiplayer. Sources: [hyperbeam.com](https://hyperbeam.com/), [docs](https://docs.hyperbeam.com/llms.txt).

**Price.** 10,000 participant-minutes a month free, then $0.007 per participant-minute ([hyperbeam.com](https://hyperbeam.com/)). A Room of 5 for an hour is 300 participant-minutes, about $2.10 (inferred).

**Control model.**

- Roles include `control` (mouse and keyboard, on by default for everyone) and `cursor_data`.
- To get a single driver, remove `control` from everyone but the driver with `removeRoles`/`addRoles`, or start the session with `control_disable_default` ([Roles](https://docs.hyperbeam.com/guides/roles.md), [start Chromium session](https://docs.hyperbeam.com/rest-api/dispatch/start-chromium-session.md)).

**Session settings.** `width`/`height` (default 1280×720), `fps` from 24 to 60, `quality` (sharp, smooth, or blocky), `region` NA, EU, or AS, `start_url`, `kiosk`, `webgl` (start session doc).

**Bandwidth.** 720p30 takes 6.3 Mbps and 1080p30 takes 14.1 Mbps; "sharp" mode triples those ([FAQ](https://docs.hyperbeam.com/home/faq)).

**Zoom quality.** Weak.

- `hb.resize(w,h)` changes the window's pixel size, but a maximum area is fixed when the session is created (default 1280×720) and "you cannot change the maximum browser window area once set." Past that area, the docs say to scale with CSS ([Resize](https://docs.hyperbeam.com/guides/resize-browser-window.md)).
- No DPR setting is documented, so zooming in past 1× blurs.

**Latency.** Marketing mentions international servers "optimized to provide minimal latency" but gives no numbers. WebRTC is typically below 100 ms (unverified).

**CPU and memory.** None on our side.

**(a) Mac.**

- The browser runs in Hyperbeam's cloud, so it can't load a Mac's `localhost` dev server without a public tunnel (inferred).
- It's workable only if we add a tunnel, which is extra moving parts and exposes the dev server to the internet.

**(b) Hosted.**

- Point `start_url` at the Sandbox's public `sandbox.domain(port)` URL (inferred).
- The browser runs outside the Sandbox, so the Sandbox needs no extra CPU.
- Whether our dev-server URLs sit behind auth that Hyperbeam's browser would need to get past is still open.

### 4. Browserbase (hosted automation browsers, with Live View)

**Price.**

| Plan | Price | Browser hours included | Overage | Concurrent sessions | Max session |
|---|---|---|---|---|---|
| Free | $0 | 1 hr | – | 3 | 15 min |
| Developer | $20/mo | 100 hrs | $0.12/hr | 25 | 6 h |
| Startup | $99/mo | 500 hrs | $0.10/hr | 100 | 6 h |

Source: [Plans](https://docs.browserbase.com/guides/plans-and-pricing).

**Live View.**

- `sessions.debug(id)` returns `debuggerFullscreenUrl`, which you embed in an iframe. It's interactive, and you get read-only by adding `pointer-events: none`.
- Every tab has its own URL. The viewport is set when the session is created ([Live View](https://docs.browserbase.com/features/session-live-view)).
- No per-viewer roles are documented, so single-driver control would mean making non-drivers' iframes inert on our side (inferred).
- The streaming technology isn't stated clearly. It is probably CDP screencast in a DevTools-style frontend (unverified).

**Zoom quality.** No DPR setting is documented for Live View. Treat it as fixed resolution (unverified).

**(a) Mac and (b) hosted.** Same as Hyperbeam: it can load the Sandbox's public URL but not a Mac's localhost without a tunnel (inferred).

**Fit.** Built for agent automation. Paying per browser-hour is cheaper than Hyperbeam's per-participant pricing for big Rooms, but control handoff and quality are weaker.

### 5. Steel (hosted, open-source core)

**Price.**

| Plan | Base price | Browser hour | Concurrent sessions | Max session |
|---|---|---|---|---|
| Launch | $0 | $0.10 | 10 | 15 min |
| Scale | $250/mo | $0.08 | 100 | 1 h |

Enterprise sessions run up to 24 h. Source: [Pricing/Limits](https://docs.steel.dev/overview/pricinglimits).

**Live view.** Steel has a session-viewer or debug URL, but it wasn't documented on the pages checked. The open-source `steel-browser` has a CDP-based viewer (unverified).

**Fit.** A 15-minute or 1-hour session cap is bad for a Room that stays open. Its value for us is as a self-hostable reference for the CDP relay approach (unverified).

### 6. Browserless (hosted; LiveURL)

**LiveURL.** Source: [Hybrid automation](https://docs.browserless.io/baas/interactive-browser-sessions/hybrid-automation).

- It streams "full quality compressed video" over a same-origin WebSocket for both frames and input.
- `interactable: true` enables input, and `quality` takes 1–100.
- By default the viewport "resizes to match the end user's screen" (`resizable: false` turns that off).
- **"Each Live URL accepts five concurrent viewers."** A URL lasts at most 15 minutes.

**Fit.** The 5-viewer cap and 15-minute URL lifetime rule it out for Rooms. It's still useful proof that WebSocket streaming, not WebRTC, is good enough for a vendor to ship. Price not checked.

### 7. Kasm Workspaces / KasmVNC (self-hosted)

**KasmVNC** ([client docs](https://kasmweb.com/kasmvnc/docs/master/clientside.html)):

- Uses WebSocket by default, with optional "UDP transit via WebRTC".
- Encodes a mix of JPEG and WebP and sends nothing when the screen doesn't change.
- Supports server-side "Remote Resizing" or client-side "Local Scaling".
- Lets several users share a session with "read-only or read/write access."

**Resources.** The baseline workspace is 2 CPUs and 4 GB ([sizing guide](https://www.kasmweb.com/docs/latest/how_to/sizing_operations.html)).

**Price.** Community Edition is free for "testing, non-profits and non-commercial activities" with 5 concurrent sessions. Paid Starter is priced per named user or per concurrent session, and the price wasn't checked ([Licensing](https://www.kasmweb.com/docs/latest/license.html)).

**Fit.** A full desktop stack. It's heavier than a CDP relay, the licence is a problem for a commercial product, and it has the same X-server DPR limit as neko (inferred).

### 8. WKWebView snapshotting (Mac only)

- `WKWebView.takeSnapshot(with:completionHandler:)` "Generates a platform-native image from the web view's contents asynchronously" ([Apple docs](https://developer.apple.com/documentation/webkit/wkwebview/takesnapshot(with:completionhandler:)), abstract only; the full page needs JavaScript).
- `WKSnapshotConfiguration` sets `snapshotWidth` and `afterScreenUpdates`, so the output resolution can follow zoom ([WKSnapshotConfiguration](https://developer.apple.com/documentation/webkit/wksnapshotconfiguration)).
- It's pull-only. There is no damage event, so we'd have to poll, and each snapshot goes through the main thread. Frame rates would be low and CPU cost high (unverified).
- There's no documented way to inject trusted input. We'd have to synthesize DOM events through `evaluateJavaScript`, which fails on `isTrusted` checks, IME, and native controls (inferred).
- The WebView would also need to stay live off-screen in the Tauri app.
- Capturing the window with ScreenCaptureKit gives real video but requires the Screen Recording permission (unverified).

**Verdict.** Fine for thumbnails, which is what the Thumbnail Capturer already does. Not for live driving.

## Can it run inside a Vercel Sandbox? (b)

Facts from Vercel's docs:

- **Base OS.** Legacy `runtime` sandboxes run **Amazon Linux 2023**, with `dnf` and `sudo`. Since 2026-08-07, runtimes are deprecated. SDK v3 defaults to the Ubuntu-based `vercel/sandbox/universal:latest` image, which uses `apt-get` ([Runtimes](https://vercel.com/docs/sandbox/concepts/runtimes), [Images](https://vercel.com/docs/sandbox/concepts/images)).
  - Screenplay pins `@vercel/sandbox@^2.0.0-beta.13` and passes no `runtime` (`apps/app/lib/sandbox/provisioning.ts`), so today it gets the AL2023 `node24` runtime (inferred from the "node24 is the default runtime… on version 2" line).
- **Installing packages.** `sandbox.runCommand({ cmd: 'dnf', args: ['install','-y',…], sudo: true })`. Installed packages don't survive a shutdown, so use a snapshot or a custom image ([KB guide](https://vercel.com/kb/guide/how-to-install-system-packages-in-vercel-sandbox)).
  - Custom OCI images must be `linux/amd64`, and Vercel doesn't run their `ENTRYPOINT`/`CMD` ([Images](https://vercel.com/docs/sandbox/concepts/images)).
- **Chromium on AL2023.** It isn't in the AL2023 repos. Maintainers and the community point to Google Chrome's RPM (`dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm`) or `npx @puppeteer/browsers install chrome@stable` ([amazon-linux-2023#417](https://github.com/amazonlinux/amazon-linux-2023/discussions/417)).
  - The repo already depends on `@sparticuz/chromium`, a Lambda-oriented AL2023 build, for hosted thumbnails (`apps/app/package.json`). That's a third option (inferred).
  - On the Ubuntu images it's `apt-get install chromium`, or Chrome for Testing (unverified for Ubuntu 26.04 packaging).
- **Limits.**
  - Each vCPU brings 2 GB of memory. Allowed sizes are 1 vCPU or an even number from 2 to 32, and the default is 2.
  - Pro allows at most 8 vCPUs / 16 GB and **15 open ports**. Sessions run at most 24 h on Pro and 45 min on Hobby.
  - Disk is 64 GB on SDK 3 or custom images, 32 GB on runtimes ([Pricing & quotas](https://vercel.com/docs/sandbox/pricing), [SDK reference](https://vercel.com/docs/sandbox/sdk-reference)).
- **Ports.** `ports: number[]` is declared when the Sandbox is created, and `sandbox.domain(port)` returns a public `https://sb-….vercel.run` URL. The docs don't say which protocols pass through.
  - Screenplay already serves ttyd's **WebSocket** on exposed port 7681 (`TERMINAL_PORT`, `apps/app/lib/sandbox/terminal-access.ts`), so WebSocket upgrades demonstrably work.
  - Nothing documents UDP or raw TCP (inferred: not available).
- **Price** (Pro, `iad1`). $0.128 per Active-CPU hour (time spent waiting on I/O isn't billed) plus $0.0212 per GB-hour of provisioned memory.
  - Traffic on exposed ports is billable data transfer, "Included in Flat Rate CDN" on Pro.
  - A 2 vCPU / 4 GB Sandbox running Chrome and a dev server for 1 h at 50% CPU costs about 4 × 0.0212 + 1 × 0.128 ≈ **$0.21/hr** (inferred).

**What this means for #983 on hosted:**

- `SANDBOX_VCPUS` is `1` today (`apps/app/lib/sandbox/provision-internals.ts`), which is 2 GB shared with the dev server and the harness. Chrome needs at least 2 vCPUs (inferred).
- Add a fourth port for the relay's WebSocket, alongside dev, proxy, and terminal.
- Put Chrome in the snapshot or a custom image so it isn't reinstalled every time the Sandbox starts.
- WebRTC-based stacks (neko, and KasmVNC's UDP mode) would need an external TURN/TLS server, because the Sandbox exposes only HTTPS/WSS (inferred).

## Summary matrix

| Option | Input latency | CPU/RAM per tab | Price | DPR follows zoom? | (a) Mac next to Tauri | (b) Vercel Sandbox |
|---|---|---|---|---|---|---|
| CDP screencast + relay | Medium: JPEG over WS, ack-gated (unverified numbers) | Low: headless Chrome only | Free + host | **Yes**: `deviceScaleFactor` is separate from viewport | **Yes**: Chrome for Testing + own `--user-data-dir` | **Yes**: WS on an exposed port; bump to 2+ vCPU |
| neko | Low: WebRTC (unverified) | High: 4 cores / 3 GB rec. for 720p30 | Free + host | No: X resolution only | Awkward: Docker VM, can't see host `.localhost` | Poor: needs UDP/TCP or external TURN |
| Hyperbeam | Low: WebRTC (unverified) | None on our side | $0.007 / participant-min | No: fixed max area | Needs public tunnel | Yes, pointed at the Sandbox's public URL |
| Browserbase | Not published | None on our side | $0.10–0.12 / browser-hr + plan | Not documented | Needs tunnel | Yes, via public URL |
| Steel | Not published | None on our side | $0.08–0.10 / browser-hr | Not documented | Needs tunnel | Yes, but 15 min–1 h session caps |
| Browserless LiveURL | Not published | None on our side | Not checked | Resizes to viewer | Needs tunnel | Yes, but **5 viewers max** |
| Kasm / KasmVNC | Medium (WS) / low (WebRTC) | 2 CPU / 4 GB baseline | CE non-commercial only | Remote resize (layout changes) | Awkward | Poor, like neko |
| WKWebView snapshot | High: polling | Main-thread bound | Free | Yes: `snapshotWidth` | Yes | No |

## Open questions for #983 to measure

1. Input-to-picture latency of the CDP relay, on localhost and across the internet, at DSF 1, 2, and 3, while scrolling and during CSS animation. Compare against Hyperbeam on the same page.
2. Chrome's CPU in a 2-vCPU Sandbox with the dev server running, at the expected repaint rates.
3. Whether changing `deviceScaleFactor` in the middle of a session causes a visible reflow or state loss in real prototypes. For example, `matchMedia('(resolution…)')` listeners.
4. Whether exposed Sandbox ports sit behind any auth that a hosted browser (the Hyperbeam fallback) would need to get past.
