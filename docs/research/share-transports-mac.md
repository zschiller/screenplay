# Which share transports can give a Mac-hosted room a link?

Research for issue #989, part of the map in #988 ("Wayfinder: Share a room from the Mac"). Written 2026-09-28.

## Read this first: how well this is sourced

This session could not reach the vendor sites. The agent proxy refused Tailscale and Cloudflare docs (`CONNECT tunnel failed, response 403`), and web fetches could not be approved. So:

- **Repo facts** (what the Mac serves, how the hosted build enforces viewers) were read from the code and are cited with file and line.
- **Every vendor fact** (Tailscale, Cloudflare, Liveblocks behavior, prices, limits, licenses) is **unverified (from memory)**. The knowledge is current to about mid-2026. Each section gives the primary source URL where that fact lives, so a follow-up can check it in a few minutes. Prices, plan limits and beta status change often. Check those before anything is specced on them.

In the tables, "(u)" means unverified (from memory).

## The question

A room lives on the Mac. Zack wants viewers to open it from "a public sharable link or maybe tailnet is fine". Viewers must be read-only, and the Mac should ideally accept no inbound connections. The three candidates are:

1. **Tailscale.** Share inside a tailnet, or use Funnel for a public link.
2. **Cloudflare Tunnel.** Quick tunnels or named tunnels.
3. **Relay through hosted Screenplay.** The Mac pushes outbound to the hosted build, and viewers use the hosted app.

## What the Mac would have to expose (repo facts)

These determine what a transport has to carry:

| Service | Bind today | Protocol | Auth | Source |
|---|---|---|---|---|
| Next sidecar (the app) | `127.0.0.1:<random>` | HTTP | none for local | `apps/desktop/src-tauri/src/sidecar.rs`, `apps/desktop/README.md` |
| Yjs sync | `:1234`, all interfaces | WebSocket (y-websocket) | none | `apps/app/lib/yjs-host/y-websocket-server.ts:212-226` |
| Terminal | `127.0.0.1` | WebSocket; `?host=1` opens a shell in `$HOME` | none | `apps/app/lib/terminal/local/server.ts` |
| Bridge proxy, one per frame | `0.0.0.0:<port>` | HTTP + WebSocket upgrade (HMR), strips CSP | none | `apps/app/lib/sandbox-bridge/proxy.mjs:145-160` |

A frame's preview URL is `http://localhost:<hostPort>` (`apps/app/lib/sandbox/local/provider.ts:448`). A remote viewer resolves `localhost` to their own machine, so frames load blank whatever transport is picked. Every option below needs a URL rewrite for viewers.

Two consequences apply to all three transports:

- **Nothing on the Mac is read-only today.** y-websocket accepts writes from any client that connects. If a transport exposes the Yjs port or the Next app as they are, a viewer can edit. The terminal must never be exposed. Read-only enforcement has to come from either (a) a new read-only gateway on the Mac that only forwards what viewers may see, or (b) a service that is not our code (Liveblocks' `room:read`, see option 3).
- **Frames are the hard part.** A frame is a whole web app (HTML, JS, assets, HMR socket) on its own port. It needs its own origin (hostname) or a path prefix. Most dev servers break under a path prefix unless configured with a base path. So "one hostname per frame" matters.

## How a tailnet works, in plain terms

Think of a tailnet as a private club network that only your own devices, and people you invite, can join.

- **Everyone installs the Tailscale app and signs in.** Signing in with Google, GitHub, Microsoft or Apple puts that device into your tailnet. Each device gets a private address (like `100.x.y.z`) and a name (like `zacks-mac.tail1234.ts.net`). (u)
- **Devices talk to each other directly and encrypted.** Under the hood each pair of devices opens a WireGuard tunnel. Tailscale's servers only hand out keys and addresses, the "phone book" (the coordination server). They don't see your traffic. (u)
- **It works behind home routers without opening ports.** Both devices reach out to Tailscale first. That lets them "punch a hole" through their routers so they can reach each other directly. When that fails (strict corporate or phone networks), traffic bounces through Tailscale's relay servers, called DERP. The relays still can't read it, because it stays encrypted end to end. (u)
- **Access is opt-in.** Someone outside your tailnet can't reach your Mac at all. To let a friend in, you either invite them as a user (they join your tailnet) or **share one device** with them. Sharing puts just that one Mac into their tailnet, and the shared Mac can't start connections back into theirs. (u)
- **Funnel is the exception that makes it public.** Funnel tells Tailscale's edge servers to accept public internet traffic for `https://zacks-mac.tail1234.ts.net` and forward it down the tunnel to one local port on your Mac. Then anyone with a browser can open the link, with no Tailscale app needed. Without Funnel, only tailnet members can open the link. (u)

The catch for Screenplay: in tailnet mode **every viewer has to install Tailscale and have an account**. That is fine for "me and a co-worker". It is not a "send anyone a link" experience.

Sources to verify: [What is Tailscale](https://tailscale.com/kb/1151/what-is-tailscale), [Connection types](https://tailscale.com/kb/1257/connection-types), [DERP servers](https://tailscale.com/kb/1232/derp-servers), [Sharing](https://tailscale.com/kb/1084/sharing), [Funnel](https://tailscale.com/kb/1223/funnel).

## Option 1: Tailscale (tailnet share, or Funnel)

| Question | Tailnet share | Funnel |
|---|---|---|
| Sharer installs / signs up | Tailscale app + account (SSO login) (u). Or Screenplay embeds `tsnet`, but it still needs an auth key or an interactive login (u) | Same, plus HTTPS certs and MagicDNS enabled, and a `funnel` node attribute in the tailnet policy. The admin console offers a one-click enable (u) |
| Viewer needs | Tailscale installed, an account, and to be invited or have the device shared with them (u) | A browser only (u) |
| NAT traversal | WireGuard with UDP hole punching. It falls back to DERP relays (and newer peer relays) over HTTPS/443 (u) | The public client connects to Tailscale Funnel relay servers. Those forward raw TCP over the tailnet to the Mac, and TLS terminates on the Mac (u) |
| Inbound to the Mac? | No port forward and no listening public port. The Mac does accept peer WireGuard packets through the hole-punched path, which are authenticated by key (u) | No public listening port. Public requests arrive inside the tunnel, so it is logically inbound public traffic handled by `tailscaled` on the Mac (u) |
| One hostname per frame? | **No wildcards.** One name per node, `<machine>.<tailnet>.ts.net`. Routing is by port or by path (`tailscale serve --set-path`) (u). The workaround is one `tsnet` node per frame, each its own device and name (u) | **No.** Same single name, and Funnel only allows ports **443, 8443, 10000** (u). So there are at most three public origins per node, plus path routing |
| WebSockets (Yjs, HMR) | Yes, it's plain IP (u) | Yes, Serve/Funnel proxies HTTP upgrades (u) |
| Cost / limits | Personal plan is free (about 3 users, 100 devices) (u). Node sharing is available on free plans (u) | Available on all plans including free (u). Bandwidth limits are "non-configurable" and undocumented. It was still labelled beta when last checked (u) |
| Vendor / drive from Tauri | The OSS client is **BSD-3-Clause** (u) ([LICENSE](https://github.com/tailscale/tailscale/blob/main/LICENSE)). The macOS GUI app is not OSS (u). You can drive the installed app with `tailscale serve/funnel` CLI or its LocalAPI (u). To embed, use `tsnet` (Go) or `libtailscale` (C bindings to tsnet). That means a Go-built sidecar or dylib of roughly 20-40 MB (u, estimate) | Same as tailnet share |

Assessment: tailnet share is the tidiest private option. Viewers are authenticated by Tailscale identity, and nothing is public. But every viewer must install Tailscale. Funnel gives a public link but only one hostname and three ports. That fights the one-origin-per-frame need and pushes all routing through a gateway on the Mac under path prefixes. It also depends on a beta feature with undocumented bandwidth caps.

Sources to verify: [Funnel](https://tailscale.com/kb/1223/funnel), [Serve](https://tailscale.com/kb/1242/tailscale-serve), [tsnet](https://tailscale.com/kb/1244/tsnet), [Pricing](https://tailscale.com/pricing), [libtailscale](https://github.com/tailscale/libtailscale).

## Option 2: Cloudflare Tunnel (quick or named)

| Question | Quick tunnel (`trycloudflare.com`) | Named tunnel |
|---|---|---|
| Sharer installs / signs up | Only the `cloudflared` binary. **No account** (u) | A Cloudflare account and a domain whose DNS is on Cloudflare (u). Alternatively, **Screenplay owns the account and domain** and mints a tunnel per user via the API. The user then signs up for nothing, and the Mac just runs `cloudflared tunnel run --token <t>` (u) |
| Viewer needs | A browser (u) | A browser. Optionally add Cloudflare Access (login wall) in front, free for up to 50 users (u) |
| NAT traversal | `cloudflared` dials **outbound** to Cloudflare's edge, on port 7844 over QUIC, falling back to HTTP/2 over TCP (u) | Same. It keeps several outbound connections to at least two data centers (u) |
| Inbound to the Mac? | **None.** All traffic comes back down connections the Mac opened (u). `cloudflared` then makes local requests to `localhost:<port>` | **None** (u) |
| One hostname per frame? | **No.** One random `*.trycloudflare.com` name per `cloudflared` process (u). Per-frame would mean one process per frame | **Yes.** Ingress rules map hostnames (wildcards allowed) to local services, and a wildcard DNS record points `*.share.example.com` at the tunnel (u). Free Universal SSL covers only one wildcard level (`*.example.com`), so use `frame-<id>--<room>.example.com` style names, not nested subdomains (u) |
| WebSockets | Yes (u) | Yes, WebSockets are proxied by default (u) |
| Cost / limits | Free. Meant for testing: no SLA, a cap of about **200 concurrent in-flight requests**, and **no Server-Sent Events** (u). The name changes on every run | The tunnel itself is free (u). Free-plan request body limit is 100 MB (u). Cloudflare ToS and acceptable-use apply to whoever owns the account (u). If Screenplay owns it, Screenplay carries the abuse risk for arbitrary user dev servers on its domain |
| Vendor / drive from Tauri | `cloudflared` is **Apache-2.0**, a single Go binary of roughly 30-40 MB (u) ([LICENSE](https://github.com/cloudflare/cloudflared/blob/master/LICENSE)). Ship it as a Tauri sidecar and drive it through the CLI. There is no embeddable SDK, and `cloudflared` is the supported client (u) | Same binary. Remote-managed tunnels are configured through the Cloudflare API. The Mac only needs the token (u) |

Assessment: this is the best fit for "a public link with no inbound connections". A named tunnel on a Screenplay-owned domain gives every frame its own hostname through one outbound connector. Quick tunnels are good enough for a zero-signup first version of the room link, but their limits (random name, no SSE, request cap, "testing only") rule them out as the long-term transport. Cloudflare only carries traffic. It does **not** make anything read-only. That still needs a read-only gateway on the Mac, and each frame being public means the frame's own (unsafe, per #988) dev server is on the internet.

Sources to verify: [Quick tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), [Configuration file / ingress rules](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/configuration-file/), [Tunnel with firewall](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/tunnel-with-firewall/), [Universal SSL limits](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/), [Access pricing](https://www.cloudflare.com/plans/zero-trust-services/).

## Option 3: Relay through hosted Screenplay

The Mac signs in to the hosted build and pushes the room outbound. Viewers open the room in the hosted app like any shared room.

| Question | Answer |
|---|---|
| Sharer installs / signs up | Nothing new to install. A hosted Screenplay account (GitHub login via Better Auth, per #988) and a "Publish room" action in the Mac app |
| Viewer needs | A browser and, with today's share model, a Screenplay login. A logged-out public link would be a new hosted feature |
| NAT traversal | The Mac dials out over HTTPS/WSS to the hosted API and Liveblocks. It works anywhere the Mac can browse the web |
| Inbound to the Mac? | **None for the canvas.** The Mac is just another Yjs client of the Liveblocks room |
| Read-only | **Strongest of the three.** The hosted build already maps `viewer` to `["room:read", "room:presence:write"]` on the Liveblocks room (`apps/app/lib/yjs-host/liveblocks-server.ts:59-66`). So Liveblocks' servers, not code on the Mac, reject viewer writes. A bug on our side in the Mac app can't hand a viewer write access to the Mac |
| One hostname per frame? | Not applicable to the canvas. **Live frames are not carried.** Liveblocks syncs the Y.Doc, not HTTP. Showing live frames needs either (a) static snapshots or thumbnails uploaded by the Mac, (b) a reverse HTTP tunnel we build and host (effectively running our own ngrok, with a wildcard domain), or (c) delegating frames to option 2 |
| WebSockets | Yjs: yes, through Liveblocks' own WebSocket (u, but this is how the hosted build already works). HMR: only if (b) or (c) |
| Cost / limits | Liveblocks usage on the hosted plan: connections and monthly active users per room (u; check [Liveblocks pricing](https://liveblocks.io/pricing)). Hosting a frame relay (b) would be new infrastructure with bandwidth cost |
| Vendor / drive from Tauri | Nothing to vendor. `@liveblocks/yjs` ^3.18.3 is already a dependency (`apps/app/package.json:34-36`). The work is a desktop-to-hosted auth handshake and bridging the local y-websocket doc to the Liveblocks provider |

Assessment: this is the safest for the canvas. It takes no inbound connections and gets read-only enforcement from a third party that already exists. But it does nothing for live frames. It also ties the desktop app, built to be offline and single-user, to a hosted account.

## Comparison

| | Tailnet share | Tailscale Funnel | CF quick tunnel | CF named tunnel (Screenplay-owned domain) | Hosted relay |
|---|---|---|---|---|---|
| Sharer signs up | Tailscale (u) | Tailscale + enable Funnel (u) | nothing (u) | nothing, if Screenplay mints tunnels (u) | hosted Screenplay |
| Viewer needs | Tailscale + account (u) | browser (u) | browser (u) | browser (u) | browser + login (today) |
| Public link | no | yes | yes | yes | yes |
| Mac inbound | tunnel peers only (u) | public traffic via tunnel (u) | none (u) | none (u) | none |
| Hostname per frame | no (u) | no, 3 ports (u) | no (u) | **yes, wildcard** (u) | n/a (no live frames) |
| WebSockets | yes (u) | yes (u) | yes, no SSE (u) | yes (u) | Yjs yes; HMR no |
| Read-only enforced by | our Mac gateway | our Mac gateway | our Mac gateway | our Mac gateway (+ optional Access) | **Liveblocks** |
| Cost | free tier (u) | free, beta, undocumented bandwidth cap (u) | free, testing only (u) | free tunnel; Screenplay owns domain and abuse risk (u) | Liveblocks usage (u) |
| Vendor | BSD-3 tsnet/libtailscale, Go (u) | same | Apache-2.0 `cloudflared` sidecar (u) | same | already a dependency |

## Recommendation

- **The canvas goes through the hosted relay (option 3).** It is the only option where read-only is enforced by someone else's server (Liveblocks `room:read`, already wired in `liveblocks-server.ts:64-66`), with no inbound connections to the Mac. That directly answers Zack's "any one bug on our side would give root over the url" worry.
- **Live frames, if they are shared at all, go through a Cloudflare named tunnel** on a Screenplay-owned wildcard domain, minted per share through the API. That way the sharer signs up for nothing, the Mac takes no inbound connections, and each frame gets its own origin. It should sit behind the `SharingTransport`-style seam #988 asks for. Quick tunnels can be a stand-in during development. Whether frames are shared at all is a question for the isolation question in #988, since this puts unsafe dev servers on the public internet.
- **A tailnet is a reasonable private alternative for the seam, not the default.** Every viewer needs Tailscale, and Funnel's single hostname and 3 ports don't fit per-frame origins.
- **Before speccing:** confirm every "(u)" row against the linked pages, especially Funnel ports and beta status, quick-tunnel limits, Universal SSL wildcard depth, Tailscale free-plan limits, and Liveblocks pricing.
