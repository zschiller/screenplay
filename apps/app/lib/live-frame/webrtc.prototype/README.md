# PROTOTYPE: shared live frame streamed as video

Throwaway, not for main. Reopens #983 (streamed frame, dropped as too laggy) with real video instead
of CDP JPEG screencasts, and adds the agent as one more driver. Results: [results.md](results.md).

One live instance per frame: a headful Chromium on its own Xvfb display, grabbed and encoded once by
ffmpeg, fanned out to every viewer over a WebSocket (WebCodecs decode) or WebRTC (werift). Input from
the current driver goes in through CDP. Driving follows the #981 handoff: one driver, others request,
the driver grants. The agent uses the same gate over HTTP.

```sh
cd apps/app/lib/live-frame/webrtc.prototype && npm i      # werift, ws (kept out of the workspace)
node server.mjs [--frames 1] [--fps 60] [--page spinner|busy] [--codec h264|vp8] [--cpus 0,1] [--delay 40]
open http://127.0.0.1:4990/viewer?transport=ws&name=zack  # or transport=webrtc; open two to try handoff
node agent.mjs --out ./shots                              # the agent drives to Settings → Billing → Team plan
node bench.mjs --transport ws --n 30 --cpus 2,3           # input → picture, smoothness, server CPU
```

Needs Linux with Xvfb, ffmpeg (libx264/libvpx) and Chromium (`CHROME=`). Use `--codec vp8` with the
Playwright Chromium, which has no H.264 decoder.
