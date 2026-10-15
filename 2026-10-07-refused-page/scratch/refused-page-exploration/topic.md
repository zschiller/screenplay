# Refused page exploration (#1931)

- Owner's words (issue #1931): "No identity shows the refused page with the extension's message and no wording of its own. Starts with a design exploration of the refused page."
- Question: What does a viewer the identity extension refused see?
- Page: https://claude.ai/artifact/8izfmrCGHhxgzcUYvsRT7z
- Round 1 options: A sign-in screen (logo, message, host-labelled button; recommended), B canvas route state (Empty, eye-slash, no title), C message as Unbounded headline + "Sign in" button.
- Pick: pending (decision card in the thread). PR #1949 builds A.
- Never re-offer: none yet.
- Captures: scratch page explore-page.tsx and screens.ts here, shot with `pnpm screenshots:shots --label refused`, cropped to the centre with PIL.

## Tailscale identity facts (checked 2026-10-07 against tailscale/tailscale main source; tailscale.com docs blocked from the container)
- `tailscale serve` (ipn/ipnlocal/serve.go addTailscaleIdentityHeaders) first deletes client-sent Tailscale-User-Login, Tailscale-User-Name, Tailscale-User-Profile-Pic, Tailscale-Funnel-Request, Tailscale-Headers-Info, then sets Login/Name/Profile-Pic from WhoIs of the TCP source.
- Not set for: Funnel requests (sets Tailscale-Funnel-Request: ?1 instead), callers outside the tailnet or the local machine, tagged nodes.
- Login and Name are RFC 2047 Q-encoded (mime.QEncoding) when non-ASCII; empty if not valid UTF-8.
- `tailscale whois --json ip[:port]` prints apitype.WhoIsResponse: { Node, UserProfile { ID, LoginName, DisplayName, ProfilePicURL }, CapMap }. Tagged node: Node.Tags non-empty.

## PR #1949 status
Draft. #1931 rescoped to Mac app + Tailscale under #1921, blocked by #1950 (one seam style). Reshape after #1950 merges: drop trusted-header/config wiring; keep listener/allowlist/strip/refused-page pieces.
