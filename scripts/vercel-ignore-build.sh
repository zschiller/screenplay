#!/usr/bin/env bash
# Vercel "Ignored Build Step" for every app in the monorepo (see each app's
# vercel.json). Exit 1 = build, exit 0 = skip.
#
# Production deploys always build. Preview deploys are opt-in, because they
# burn build credits: they build only when the commit message contains
# "[preview]" or the pull request carries the "preview" label.

set -u

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Production deploy: building."
  exit 1
fi

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[preview]"*)
    echo "Commit message opts in with [preview]: building."
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
  if printf '%s' "$labels" | grep -Eq '"name": *"preview"'; then
    echo "PR #${pr} has the preview label: building."
    exit 1
  fi
fi

echo "Preview skipped. Add the \"preview\" label to the PR and push, or push a commit with [preview] in its message."
exit 0
