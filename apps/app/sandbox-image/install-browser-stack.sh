#!/usr/bin/env bash
# Installs the browser stack shared frames need (#1386) on top of Vercel's
# Ubuntu Sandbox image: Google Chrome (its own H.264 build, which the #1366
# bench ran), Xvfb for a display, and ffmpeg to encode it. Runs as root, from
# the Dockerfile next to it.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends xvfb xauth ffmpeg fonts-liberation fonts-noto-color-emoji
curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y --no-install-recommends /tmp/chrome.deb
rm -f /tmp/chrome.deb
rm -rf /var/lib/apt/lists/*

google-chrome --version
ffmpeg -hide_banner -version | head -n1
command -v Xvfb
