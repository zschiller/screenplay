# The image every hosted Workspace Sandbox boots from (#1388): Vercel's
# Ubuntu image (Node, pnpm, git, the coding CLIs) plus the browser stack shared
# frames need. `.github/workflows/sandbox-image.yml` builds it and pushes it to
# the app project's Vercel Container Registry as `screenplay-workspace`.
# Sandboxes don't run ENTRYPOINT or CMD.
ARG BASE_IMAGE=vcr.vercel.com/vercel/sandbox/universal:latest
FROM ${BASE_IMAGE}

USER root
ENV HOME=/root
COPY install-browser-stack.sh /tmp/install-browser-stack.sh
RUN bash /tmp/install-browser-stack.sh && rm /tmp/install-browser-stack.sh

# Back to the base image's user and home. The worktree is every command's
# default cwd; the app moves the git clone here when it creates a Sandbox.
ENV HOME=/vercel
USER ubuntu
RUN mkdir -p /vercel/sandbox
WORKDIR /vercel/sandbox
