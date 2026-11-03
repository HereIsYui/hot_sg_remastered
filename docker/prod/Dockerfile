# syntax=docker/dockerfile:1
#
# Multi-stage image for the docker/prod stack, built from the repository root:
#   target "server" — NestJS game server (node dist/main.js);
#   target "web"    — nginx serving the client console (/) and the GM console (/gm/).
#
# Generated original content is NOT in git: apps/client/public/assets (pnpm legacy:assets)
# and legacy/lang (pnpm legacy:lang) exist only on machines where start.exe was unpacked.
# Whatever is present in the build context is baked into the image; docs/deploy.md covers
# the degraded modes when they are missing.

ARG HOT_DOCKER_MIRROR=

FROM ${HOT_DOCKER_MIRROR}node:22-alpine AS build
WORKDIR /repo
# Pin pnpm to the version in the root package.json's packageManager field (npm install
# avoids corepack's signature-check fragility).
RUN npm install -g pnpm@10.10.0

# Install with manifests only so the layer survives source edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/gm/package.json apps/gm/
COPY tools/package.json tools/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# Vite reads VITE_* from the environment; compose passes them as build args.
ARG VITE_GM_TOKEN=
ARG VITE_ASSET_URL=/assets/
ARG VITE_REGISTER_URL=
ARG VITE_HOME_LABEL=
ARG VITE_HOME_URL=
ENV VITE_GM_TOKEN=$VITE_GM_TOKEN \
  VITE_ASSET_URL=$VITE_ASSET_URL \
  VITE_REGISTER_URL=$VITE_REGISTER_URL \
  VITE_HOME_LABEL=$VITE_HOME_LABEL \
  VITE_HOME_URL=$VITE_HOME_URL

RUN pnpm --filter @hot/shared build \
  && pnpm --filter @hot/server build \
  && pnpm --filter @hot/client build \
  && pnpm --filter @hot/gm exec vue-tsc --noEmit \
  && pnpm --filter @hot/gm exec vite build --base=/gm/

# --- Game server: dist plus a prod install of the workspace -------------------------------

FROM ${HOT_DOCKER_MIRROR}node:22-alpine AS server
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /repo/apps/server
# pnpm's isolated layout: the server's deps are symlinked from apps/server/node_modules
# into the root store, so both trees are needed for module resolution from dist/.
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/server/node_modules ./node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/server/dist ./dist
# LANG_FILE points at /repo/legacy/lang/zh_CN.json (the compose service mounts legacy/lang
# there); without the mount the server still boots and messages fall back to their keys.
CMD ["node", "dist/main.js"]

# --- Static web: client at /, GM console at /gm/, /api and /ws proxied to server ----------

FROM ${HOT_DOCKER_MIRROR}nginx:1.27-alpine AS web
COPY docker/prod/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/client/dist /usr/share/nginx/html
COPY --from=build /repo/apps/gm/dist /usr/share/nginx/html/gm
