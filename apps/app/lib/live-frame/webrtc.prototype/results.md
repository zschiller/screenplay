# Shared live frame as video: results

PROTOTYPE notes, not for main. Measured 2026-10-02 in a Linux cloud container (4 cores, no GPU,
software rendering). The streamed stack (Xvfb, Chromium, ffmpeg, server) was pinned to 2 cores as a
stand-in for a 2-vCPU Vercel Sandbox, and the bench viewer ran on the other 2. **Not measured on
Vercel Sandbox or a Mac.** The viewer-side numbers use VP8, because the container's Chromium can't
decode H.264. The CPU table uses H.264, which is what shipping browsers decode.

## The question

#983 dropped streaming because CDP JPEG screencasts were laggy (60–90 ms locally, more over a
network) and heavy (20–25 Mbps per viewer whenever anything moved). Would real video fix that, so
that one live instance per frame could be driven by everyone, the agent included?

## Verdict

- **Bandwidth is fixed.** Animated pages cost about 3 Mbps per viewer instead of 25, and still pages
  0.2 Mbps instead of 1.5.
- **Latency is not.** Click to picture is the same as #983: about 40 ms locally on a still page,
  about 120 ms at an 80 ms round trip, and 180 ms on a busy page. The network round trip dominates,
  and video adds a frame or two. Driving a stream feels like it did in #983.
- **Smoothness is good while there's CPU headroom.** Viewers get a steady 60 fps on still and
  spinner pages. A full-screen animation on 2 saturated cores stutters (p99 frame gap 60 ms).
- **Native popups now show.** The stream grabs a real display, so a `<select>`'s list appears in the
  stream and in the agent's screenshots. #983 couldn't show them.
- **The agent drives it fine.** `agent.mjs` asks for control, clicks through Settings → Billing,
  types seats, picks a plan in the native select with the arrow keys and submits. Everyone watching
  sees it live. Screenshots: `shots/`.
- **A WebSocket beats WebRTC here.** H.264 over a WebSocket with WebCodecs decode was as fast or
  faster locally, and it fits through the HTTPS-only ports a Sandbox exposes. WebRTC would need UDP
  or a TURN relay.

## Input → picture (viewer on its own cores, 60 fps stream, VP8)

| Path | Page | Click p50 / p90 | Key p50 / p90 |
|---|---|---|---|
| ws, local | still | 37 / 62 ms | 36 / 53 ms |
| ws, local | spinner | 45 / 70 ms | 39 / 48 ms |
| ws, local | busy | 116 / 157 ms | 90 / 125 ms |
| ws, 80 ms round trip | still | 117 / 135 ms | 116 / 123 ms |
| ws, 80 ms round trip | busy | 177 / 286 ms | 148 / 202 ms |
| webrtc, local | still | 65 / 81 ms | 71 / 82 ms |
| webrtc, local | busy | 112 / 150 ms | 115 / 163 ms |
| #983 JPEG, local | still / busy | 38 / 42, 89 / 102 ms | |
| #983 JPEG, 80 ms | still / busy | 117 / 129, 167 / 218 ms | |

Busy-page latency is high partly because the 2 streamed cores were saturated (Chromium software
rendering ~40% plus encoding). WebRTC decoded a steady 60 fps (13 ms jitter buffer). Headless
`requestVideoFrameCallback` undercounts it, so the smoothness column below is from the ws viewer.

## Smoothness at 60 fps (ws viewer, frame gaps)

| Page | Delivered | Gap p50 / p95 / p99 / max |
|---|---|---|
| still | 63 fps | 16 / 21 / 28 / 52 ms |
| spinner | 60 fps | 17 / 24 / 29 / 36 ms |
| busy (full-screen gradient, CPU saturated) | 61 fps | 15 / 28 / 62 / 165 ms |

## Cost per frame in one 2-core sandbox (H.264, x264 ultrafast/zerolatency, 1280×800)

| Page | fps | Frames | CPU (of 200%) | Memory (PSS) | Encoded fps each | Mbps per viewer |
|---|---|---|---|---|---|---|
| still | 30 | 1 / 2 / 4 | 42 / 77 / 145% | 0.50 / 0.68 / 1.06 GB | 30 | 0.16 |
| still | 60 | 1 / 2 / 4 | 82 / 151 / 207% | 0.50 / 0.69 / 1.06 GB | 60 | 0.22 |
| busy | 30 | 1 / 2 / 4 | 94 / 159 / 209% | 0.52 / 0.73 / 1.14 GB | 30 | 3.0 |
| busy | 60 | 1 / 2 / 4 | 120 / 198 / 207% | 0.52 / 0.74 / 1.12 GB | 60, 60, then ~50 at 4 | 3.2 |

- Each extra frame costs about 190 MB and about 35% of a core at 30 fps, or 65% at 60 fps.
- **It costs that even when nothing moves**, because x11grab grabs and encodes every frame. An idle
  mode (drop to a few fps until the page repaints) would make still frames nearly free. Not built.
- Viewers are cheap. The stream is encoded once and every viewer gets a copy.
- A 2-vCPU sandbox also runs the dev server and the agent. So realistically it fits one or two live
  frames at 60 fps, and more needs a bigger sandbox.
- VP8 (libvpx realtime) is about twice H.264's CPU, and two encoders on 2 cores collapsed to a few fps.
  Use H.264.

## Not measured

- Vercel Sandbox itself: no credentials in this container. The open questions are whether Xvfb and
  Chromium run there, and the real latency from a viewer to `sb-*.vercel.run`.
- A Mac. The desktop preview is WKWebView, which can't be grabbed this way. The Mac would need its
  own Chromium plus Xvfb-style offscreen capture, or ScreenCaptureKit on a hidden window.
- H.264 decode in a real browser, hardware encode, and HiDPI (2x) streams.

## Idle pause and resume (#1368)

`server.mjs --pause viewers [--pause-after ms]` stops a frame's encoder when nobody is watching and
starts it again when someone looks. The browser keeps running throughout, so no state is lost.
`--decimate` drops frames identical to the last one before they are encoded. `join.mjs` times a
viewer's wait for its first picture.

| | CPU (of 200%) | Memory |
|---|---|---|
| Paused (no viewers) | about 1% | the browser stays (about 330 MB PSS for the demo page) |
| Watched, still page, 60 fps, H.264 | 82% | |
| Watched, still page, 60 fps, H.264 + skip unchanged | 50% (the 60 fps screen grab is most of it) | |
| Watched, busy page, 60 fps, with or without skipping | about 118% | |

| Join | First picture p50 / p90 |
|---|---|
| Encoder already running | 32 / 43 ms |
| Resume from paused (encoder restart, first frame is a keyframe) | 185 / 218 ms |

- Skipping unchanged frames costs nothing in latency: click to picture stayed at 34–40 ms p50.
- With H.264 over the WebSocket, the newest access unit must be flushed when the pipe goes quiet.
  Otherwise each picture waits for the next one, which never comes on a still page. Fixed in
  `server.mjs`.
- Not built: capture that grabs only when Chromium repaints (XDamage, or CDP repaint events as the
  trigger). It would remove the remaining ~40% grab cost on watched still frames.
