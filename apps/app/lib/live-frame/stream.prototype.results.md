# Streamed frame prototype: results (#983)

PROTOTYPE notes, not for main. Measured 2026-09-28 with `stream.prototype.bench.mjs` in a Linux
cloud container: Chromium 141 headless, software rendering (SwiftShader, no GPU), the streamed
Chrome and relay pinned to 2 cores as a stand-in for a 2-vCPU Vercel Sandbox, the bench viewer on
the other 2. **Not yet measured on a Mac.**

The bench clicks (or presses a key on) a square in the demo page and times, on the viewer's clock,
how long until the square's new colour is decoded and drawn: input to picture, including JPEG
decode on the viewer. "80 ms" rows add 40 ms each way in the relay to stand in for a remote viewer.

Pages: **still** (nothing animates), **spinner** (one 18 px CSS spinner), **busy** (a large animated
gradient).

## Latency at 1x pixels

In this run the zoom column didn't change the pixels (see the next table), so it's all 1x.

| Round trip | Page | Canvas zoom | Click → picture p50 / p90 | Key → picture p50 / p90 |
|---|---|---|---|---|
| local | still | 100% | 38 / 42 ms | 35 / 47 ms |
| local | still | 200% | 36 / 46 ms | 35 / 43 ms |
| local | still | 300% | 38 / 50 ms | 38 / 42 ms |
| local | spinner | 100% | 61 / 87 ms | 63 / 71 ms |
| local | spinner | 200% | 64 / 82 ms | 48 / 75 ms |
| local | spinner | 300% | 67 / 86 ms | 62 / 68 ms |
| local | busy | 100% | 89 / 102 ms | 100 / 116 ms |
| local | busy | 200% | 90 / 107 ms | 81 / 107 ms |
| local | busy | 300% | 90 / 126 ms | 93 / 118 ms |
| 80 ms | still | 100% | 117 / 129 ms | 123 / 138 ms |
| 80 ms | still | 200% | 120 / 139 ms | 118 / 126 ms |
| 80 ms | still | 300% | 119 / 138 ms | 120 / 126 ms |
| 80 ms | spinner | 100% | 131 / 158 ms | 129 / 167 ms |
| 80 ms | spinner | 200% | 153 / 187 ms | 144 / 157 ms |
| 80 ms | spinner | 300% | 146 / 166 ms | 146 / 162 ms |
| 80 ms | busy | 100% | 167 / 218 ms | 171 / 199 ms |
| 80 ms | busy | 200% | 162 / 210 ms | 165 / 183 ms |
| 80 ms | busy | 300% | 179 / 229 ms | 183 / 206 ms |

## Sharp pixels when zoomed

Headless Chrome paints at the window's scale (1x) whatever `Emulation.setDeviceMetricsOverride`
says: the page sees `devicePixelRatio` 2 or 3, but screencast frames stay 1280×800. Sharper frames
need Chrome launched with `--force-device-scale-factor=N`, and then Chrome rasterizes at N even
while streaming at 1x. Local round trip:

| Sharpness ceiling | Streaming at | Page | Click → picture p50 / p90 | Chrome CPU (of 2 cores) | Chrome PSS | Frames/s | Mbps per viewer |
|---|---|---|---|---|---|---|---|
| 1x | 1x | still | 42 / 63 ms | 12% | 217 MB | 3.7 | 1.5 |
| 1x | 1x | spinner | 91 / 124 ms | 135% | 232 MB | 53.7 | 21.8 |
| 1x | 1x | busy | 85 / 120 ms | 153% | 230 MB | 56.8 | 25.8 |
| 2x | 1x | still | 61 / 74 ms | 18% | 263 MB | 3.4 | 1.3 |
| 2x | 1x | spinner | 106 / 130 ms | 137% | 256 MB | 29.4 | 11.6 |
| 2x | 1x | busy | 154 / 206 ms | 144% | 284 MB | 26.5 | 11.6 |
| 2x | 2x | still | 118 / 138 ms | 26% | 342 MB | 2.8 | 2.9 |
| 2x | 2x | spinner | 269 / 410 ms | 184% | 415 MB | 19.2 | 19.9 |
| 2x | 2x | busy | 303 / 417 ms | 185% | 335 MB | 17 | 19.5 |
| 3x | 3x | still | 246 / 300 ms | 41% | 464 MB | 2.1 | 3.8 |
| 3x | 3x | spinner | 476 / 613 ms | 186% | 576 MB | 8.9 | 16.4 |
| 3x | 3x | busy | 733 / 858 ms | 187% | 642 MB | 8.5 | 17.3 |

## What it's like

- **Hover, typing, backspace, clicks, CSS `:hover` tooltips and focus rings all work** through
  `Input.dispatch*`. The cursor shape isn't in the stream; the relay asks the page with
  `elementFromPoint` on mouse move and the viewer sets it.
- **Native `<select>` popups don't show.** The select opens (`:open` is true) but its popup is a
  separate widget the screencast doesn't capture. Same for other native popups (date pickers,
  `title` tooltips, `alert`). Prototypes would need custom selects, or the relay would render them.
- **Any animation means full frames at 60 fps.** Screencast has no inter-frame compression, so one
  18 px spinner costs as much as a full-screen video: ~45 KB per frame, 20–25 Mbps per viewer, and
  well over a core. A still page costs almost nothing (frames only on change).
- **Sharp zoom is expensive.** At a 2x ceiling, animated pages drop to ~20–30 fps and click latency
  roughly triples; at 3x it's 0.5–0.7 s. Viewers also spend ~40 ms decoding each 3840×2400 JPEG.
- **Memory:** Chrome's process tree is ~215–270 MB PSS for the demo page at 1x (RSS ~850–1000 MB
  counts shared pages many times), 340–420 MB at 2x and 460–640 MB at 3x. The relay is ~70–85 MB.
- **Two gotchas found building it:** an emulated viewport bigger than the headless window stalls the
  screencast after two frames, so the relay resizes the window to the viewport; and headless
  captures a ~60 px strip below the viewport, so viewers crop.
