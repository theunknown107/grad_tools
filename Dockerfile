# =============================================================================
# GradTools — the API and the monitoring worker, in one image
# =============================================================================
#
# Authority: Phase 7B.6 §3, §4, §111, §116, §117, §126, §127
#
# -----------------------------------------------------------------------------
# ONE IMAGE, TWO PROCESSES
# -----------------------------------------------------------------------------
#
# The API is a long-lived server and the worker is a one-shot command, but they
# are the same code reading the same database with the same migrations. Two
# images would be two things to build, tag, scan and accidentally let drift
# apart by a release.
#
#   API     docker run <image>                      (the CMD below)
#   worker  docker run <image> pnpm --filter @gradtools/api worker
#
# -----------------------------------------------------------------------------
# WHY A CONTAINER AND NOT A SERVERLESS FUNCTION
# -----------------------------------------------------------------------------
#
# The API holds two things open that a function cannot: a `LISTEN` session on
# PostgreSQL and an SSE response per connected student. Both are long-lived by
# design, and both are exactly what a request/response platform terminates.
#
# The worker is the opposite and could run anywhere — which is why it is a
# one-shot command rather than a daemon (§127). A university publishes a handful
# of notices a day; a process that sits in a loop to catch them is paying rent
# for a schedule the platform already provides.
#
# -----------------------------------------------------------------------------
# WHY NO PLATFORM CONFIGURATION IS COMMITTED
# -----------------------------------------------------------------------------
#
# §111: not five platforms' worth of files. This image runs on anything that
# runs OCI containers, and docs/45 lists exactly what a deployment has to
# supply. Nothing here is deployed, and nothing here claims to be.
#
# -----------------------------------------------------------------------------
# THE BUILD SHIPS SOURCE, AND THAT IS NOT AN OVERSIGHT
# -----------------------------------------------------------------------------
#
# `pnpm build` in this repository is `tsc --noEmit`: it typechecks and emits
# nothing, and the API's entry point is `tsx src/main.ts`. So the image carries
# TypeScript and a loader rather than a compiled bundle. Adding an emit step
# here would introduce a second build that nothing else in the repository uses,
# and the first divergence between them would be a production-only bug.
# =============================================================================

FROM node:22-bookworm-slim

# `dumb-init` so signals reach Node. Without an init, SIGTERM goes to PID 1 and
# the graceful shutdown in `main.ts` — which exists precisely to end SSE streams
# rather than let a deploy hang on them — never runs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PNPM_HOME=/usr/local/bin
WORKDIR /app

# Manifests first, so a change to source does not re-resolve the dependency
# graph. The lockfile is frozen: a deploy is not the moment to discover that a
# transitive dependency moved.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# `prepare`, not just `enable`. `corepack enable` installs shims only; the first
# `pnpm` call then DOWNLOADS the package manager — which was happening on every
# container start, turning a cold boot into a network round trip and making the
# image unusable anywhere egress is restricted. Found by running the image, not
# by reading the file.
#
# `COREPACK_HOME` is set somewhere both users can read, and that is the second
# half of the same bug: the build runs as root and the container runs as `node`,
# so a cache under `/root` is invisible at runtime and the download happens
# anyway. Fixing only the first half looked like it worked and did not.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
  && corepack prepare --activate \
  && chmod -R a+rX "$COREPACK_HOME"
COPY apps/web/package.json ./apps/web/
COPY packages/academic-rules/package.json ./packages/academic-rules/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/vtu-catalogue/package.json ./packages/vtu-catalogue/
COPY services/api/package.json ./services/api/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# NOT ROOT. The API reaches a database and renders text from documents this
# project did not write; there is no reason for it to be able to write to its
# own image.
USER node

EXPOSE 3001
ENV PORT=3001

# -----------------------------------------------------------------------------
# `HOST` IS DELIBERATELY NOT SET, AND THE CONTAINER IS UNREACHABLE UNTIL IT IS
# -----------------------------------------------------------------------------
#
# A container has to bind 0.0.0.0 to be reachable at all, and `main.ts` refuses
# to start on a non-loopback address: Stage 1's document routes have no
# authentication, so the bind address is the only thing protecting them
# (docs/13 §T-19).
#
# An earlier version of this file set `HOST=0.0.0.0` here and the API refused to
# boot — correctly. The fix is NOT to add `ALLOW_PUBLIC_BIND=true` and make the
# error go away: that would silently switch off a real control and publish
# unauthenticated routes to whatever the platform exposes.
#
# So the decision belongs to whoever deploys this, and has to be made out loud:
#
#   -e HOST=0.0.0.0 -e ALLOW_PUBLIC_BIND=true
#
# and only where something in front of the container authenticates those routes.
# Until Stage 1 has authentication, this image is safe on a private network and
# is NOT safe on the public internet. docs/45 says so in full.

# Liveness only. Readiness is `/health/ready`, which checks the database, and a
# container should not be restarted because a database blipped.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
# -----------------------------------------------------------------------------
# EXEC THE APP DIRECTLY, NOT THROUGH pnpm
# -----------------------------------------------------------------------------
#
# `pnpm ... start` worked and reported a lie. On SIGTERM the app shut down
# gracefully — the handler ran, the LISTEN closed, the pool drained — and pnpm
# still exited 143 with `Command failed with signal "SIGTERM"`, because it
# reports its child's signal rather than the app's own exit. Every orchestrator
# reads 143 on a normal stop as a crash, so a clean rolling restart would have
# looked like a crash loop in the event log.
#
# One less process in the chain: dumb-init -> node. The exit code is then the
# app's, which is 0.
CMD ["./services/api/node_modules/.bin/tsx", "services/api/src/main.ts"]
