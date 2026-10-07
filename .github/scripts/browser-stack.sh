#!/usr/bin/env bash
# Installs what CI's browser tests need beyond the runner's own Chrome: Xvfb,
# ffmpeg and xte (xautomation).
#
# $1 is a folder CI caches per runner image. When it holds the packages a
# past install on this image fetched, they're installed from there with no
# network. Otherwise apt fetches them into it, for the cache to keep. Each
# apt call has a time limit and is retried, so a stalled mirror fails or
# recovers in minutes instead of holding the job until it times out.
set -uo pipefail

debs=$1
# Stamped, since the wait step prints whatever ran during Setup all at once.
say() { echo "[$(date +%T)] $*"; }
have() { command -v Xvfb && command -v ffmpeg && command -v xte; } >/dev/null

have && { say "The browser stack is already installed"; exit 0; }

if compgen -G "$debs/*.deb" >/dev/null; then
  # --force-unsafe-io: skip dpkg's fsync after every file; the runner is
  # thrown away after the job anyway.
  say "Installing $(ls "$debs"/*.deb | wc -l) cached packages"
  sudo dpkg -i --force-unsafe-io "$debs"/*.deb && have && say "Installed" && exit 0
  say "The cached packages didn't install; fetching them instead"
fi

mkdir -p "$debs/partial"
apt=(sudo apt-get -q
  -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20
  -o DPkg::Lock::Timeout=60 -o Dpkg::Options::=--force-unsafe-io
  -o Dir::Cache::archives="$debs" -o APT::Sandbox::User=root)
for attempt in 1 2; do
  say "Fetching the packages (attempt $attempt)"
  timeout 60 "${apt[@]}" update &&
    say "Updated the package lists" &&
    timeout 120 "${apt[@]}" install -y -f --no-install-recommends xvfb ffmpeg xautomation &&
    have && break
  echo "::warning::Installing the browser stack failed (attempt $attempt)"
  sudo dpkg --configure -a
  [ "$attempt" = 2 ] && exit 1
done

say "Installed"

# Only the .debs go in the cache.
sudo rm -rf "$debs/partial" "$debs/lock"
sudo chown -R "$(id -u):$(id -g)" "$debs"
