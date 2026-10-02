# Workspace Sandbox sizing with live frames: results (#1384)

PROTOTYPE notes, not for main. Measured 2026-10-02 on real Vercel Sandboxes in iad1 (Pro plan,
`vercel/sandbox/universal` image), with the viewer in a second Sandbox in the same region reaching
the stream through `sb-*.vercel.run`. The Workspace was apps/homepage's Next.js 16 dev server
(Turbopack). Frames were the #1366 demo page at 1280×800, H.264, 60 fps, unchanged frames skipped
(#1368), all watched. Raw rows: `results.jsonl` (one run per scenario; a failed viewer load was
re-run once).

Loads: **idle** (dev server up, no edits), **edits** (the agent edits the page every 4 s: new text and
a new Tailwind class), **tsc** (edits plus `tsc --noEmit` back to back, the agent's checks).
**Compile** is edit → new HTML from the dev server. **CPU** is the whole Sandbox, 100% = every vCPU busy.

## Verdict

- **2 vCPU fits one live frame**, still or animated, while the agent edits. A second animated frame
  drops to ~44 fps and compiles reach 4 s at p90. Three animated frames break down (clicks ~0.5 s).
  At 30 fps, three frames hold ~27 fps but compiles take ~3 s.
- **4 vCPU fits three animated frames while the agent edits**: ~58 fps, clicks ~80 ms, compiles
  ~0.9 s. Three animated frames plus a nonstop typecheck is the edge (95% CPU, 52 fps).
- **8 vCPU has headroom (≤69% CPU) but isn't faster** per click or compile than 4. Compiles were
  ~0.85 s against ~0.55 s on 4; likely different hosts, not a real slowdown.
- **Memory peaks at 3.2 GB** (3 frames + dev server + tsc), so memory never decides the size.
- **Growing needs a restart.** `sandbox.update({ resources: { vcpus } })` applies to the next
  session only: stop ~5–7 s, resume ~9 s, every process gone (dev server cold compile 4–7 s, frames
  lose their in-memory state). `resize.mjs` measures it.
- **Decided (Zack, 2026-10-02): fixed 4 vCPU per Workspace.**

## Key scenarios (60 fps)

| vCPU | Frames | Load | Click p50 / p90 | Viewer fps (p99 gap) | CPU avg | Mem | Compile p50 / p90 |
|---|---|---|---|---|---|---|---|
| 2 | none | edits / tsc | | | 10% / 86% | 1.4 / 2.0 GB | 578 / 720, 814 / 1005 ms |
| 2 | 1 still | edits | 35 / 50 ms | | 28% | 1.7 GB | 676 / 782 ms |
| 2 | 1 busy | edits | 65 / 73 ms | 58 (59 ms) | 64% | 1.8 GB | 833 / 1565 ms |
| 2 | 1 busy | tsc | 81 / 204 ms | 50 (81 ms) | 99% | 2.3 GB | 1609 / 2129 ms |
| 2 | 2 busy | edits | 66 / 317 ms | 44 (93 ms) | 94% | 2.2 GB | 1225 / 4004 ms |
| 2 | 3 still | edits | 61 / 373 ms | | 81% | 2.5 GB | 1508 / 4624 ms |
| 2 | 3 busy | edits | 490 / 549 ms | 37 (150 ms) | 100% | 2.7 GB | 3803 / 4850 ms |
| 4 | none | edits / tsc | | | 5% / 50% | 1.5 / 1.9 GB | 523 / 588, 525 / 591 ms |
| 4 | 1 busy | edits | 63 / 154 ms | 60 (69 ms) | 28% | 1.9 GB | 531 / 600 ms |
| 4 | 2 busy | edits | 73 / 100 ms | 61 (34 ms) | 54% | 2.1 GB | 684 / 771 ms |
| 4 | 3 still | tsc | 34 / 47 ms | | 74% | 2.9 GB | 728 / 945 ms |
| 4 | 3 busy | edits | 82 / 111 ms | 58 (97 ms) | 80% | 2.6 GB | 929 / 1488 ms |
| 4 | 3 busy | tsc | 81 / 286 ms | 52 (66 ms) | 95% | 3.2 GB | 1258 / 1868 ms |
| 8 | 1 busy | edits | 53 / 73 ms | 61 (29 ms) | 25% | 2.0 GB | 971 / 1130 ms |
| 8 | 3 busy | edits | 97 / 108 ms | 62 (31 ms) | 57% | 2.8 GB | 858 / 1055 ms |
| 8 | 3 busy | tsc | 98 / 109 ms | 61 (36 ms) | 69% | 3.0 GB | 720 / 938 ms |

2 vCPU at 30 fps, busy frames: 1 frame 69 ms / 30 fps / compile 1.1 s; 2 frames 91 ms / 29 fps /
2.1 s; 3 frames 116 ms / 26 fps / 3.0 s. Typecheck runs took ~3.2 s alone on 2 vCPU, 8.5 s next to
one busy frame and 17 s next to two; ~2–3 s on 4 vCPU throughout. Cold `next dev` first compile:
4.4–7.3 s at every size. The full table is in `results.jsonl`.

## Cost (Vercel Pro, iad1, 2026-10-02 rates)

Active CPU is $0.128 per vCPU-hour actually used; provisioned memory is $0.0212 per GB-hour for as
long as the Sandbox runs, at 2 GB per vCPU. The CPU work is about the same at every size, so the
size mostly changes the memory floor:

| vCPU | Memory floor | 176 h month | Plus CPU while frames are watched |
|---|---|---|---|
| 2 | $0.085/h | ~$15 | ~$0.07/h (1 still) to ~$0.16/h (1 busy, edits) |
| 4 | $0.17/h | ~$30 | ~$0.07/h (1 still) to ~$0.41/h (3 busy, edits) |
| 8 | $0.34/h | ~$60 | ~$0.12/h (1 still) to ~$0.58/h (3 busy, edits) |

CPU per hour = measured CPU% × vCPUs × $0.128 (inferred from the pricing page, not read off a bill).
