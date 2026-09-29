#!/usr/bin/env bash
# Vercel "Ignored Build Step" for every app in the monorepo. Each app's
# vercel.json calls it with the app's name (app, docs or web).
# Exit 1 = build, exit 0 = skip.
#
# Production deploys always build. Preview deploys are opt-in, because they
# burn build credits. A preview builds when the pull request carries the
# "preview" label (every app) or "preview:<app>" (just that app), or when the
# commit's subject line contains "[preview]" or "[preview:<app>]". Only the
# subject counts, so a commit body that merely mentions a token doesn't opt in.

set -u

app="${1:?usage: vercel-ignore-build.sh <app>}"

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Production deploy: building."
  exit 1
fi

subject="$(printf '%s\n' "${VERCEL_GIT_COMMIT_MESSAGE:-}" | head -n 1)"
case "$subject" in
  *"[preview]"* | *"[preview:${app}]"*)
    echo "Commit subject opts ${app} in: building."
    exit 1
    ;;
esac

pr="${VERCEL_GIT_PULL_REQUEST_ID:-}"
if [ -n "$pr" ]; then
  repo="${VERCEL_GIT_REPO_OWNER:-}/${VERCEL_GIT_REPO_SLUG:-}"
  auth=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi
  labels="$(curl -fsSL --max-time 10 "${auth[@]}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${repo}/issues/${pr}/labels" 2>/dev/null || true)"
  if printf '%s' "$labels" | grep -Eq "\"name\": *\"preview(:${app})?\""; then
    echo "PR #${pr} has a preview label for ${app}: building."
    exit 1
  fi
fi

echo "Preview skipped. Add the \"preview\" or \"preview:${app}\" label to the PR and push, or push a commit with [preview] or [preview:${app}] in its subject line."
exit 0
