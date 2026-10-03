# 18. Drop the desktop GitHub device flow — `gh` is the only connection

Date: 2026-10-03

Status: Accepted (supersedes the device-flow parts of ADR 0008 and ADR 0014)

## Context

ADR 0008 gave the local build a device-flow "Connect GitHub" backed by an
OAuth client id (`SCREENPLAY_GITHUB_CLIENT_ID`) baked into release builds, with
the token kept in the OS keychain. ADR 0014 made guided `gh` setup (install,
then `gh auth login` in an inline terminal) the primary path and kept the
device flow as a fallback, shown only when the client id was configured.

No release ever set the client id, so the fallback never showed. Meanwhile
`gh` covers the same ground with less: no client id to register or bake in,
a login the user's own shell shares, and GitHub CLI is already approved in
most organizations, where a new OAuth app would need each org's approval
before it could see private repos.

## Decision

- **Remove the device flow.** The local token resolver returns the `gh`
  CLI's token or `null`; there is no second source. The device-flow client,
  the keychain-backed `TokenStore` (and its `@napi-rs/keyring` dependency),
  the "Use a device code instead" dialog, and Disconnect all go.
- **Remove `SCREENPLAY_GITHUB_CLIENT_ID`** from the desktop shell, the release
  script, and the docs.
- ADR 0014's one-directional rule stands: the app helps sign `gh` in and never
  signs it out. With no app-stored token there is nothing for the app to
  disconnect.

## Consequences

- Someone who won't install `gh` (or whose install fails) has no API access,
  and falls back to the no-auth floor: add a repository by local folder or
  clone URL. If that case ever matters, the device flow can come back with a
  client id from an existing OAuth app with "Enable Device Flow" ticked.
- A device-flow token stored by a development build stays in the keychain or
  `kv_store`, unread. Release builds never had one.
