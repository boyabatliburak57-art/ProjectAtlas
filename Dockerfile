# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944

FROM ${NODE_IMAGE} AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /workspace

FROM toolchain AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs .nvmrc .node-version ./
COPY scripts/check-toolchain-versions.mjs scripts/check-toolchain-versions.mjs
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json

FROM manifests AS development-dependencies
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM development-dependencies AS build
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:3001/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
RUN --mount=type=cache,id=atlas-turbo-cache,target=/workspace/.turbo \
    pnpm exec turbo run build

FROM manifests AS production-dependencies
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM ${NODE_IMAGE} AS runtime-base
ARG BUILD_DATE=unknown
ARG COMMIT_SHA=unknown
ARG SOURCE_REPOSITORY=unknown
ARG VERSION=0.0.0
LABEL org.opencontainers.image.created=${BUILD_DATE} \
      org.opencontainers.image.revision=${COMMIT_SHA} \
      org.opencontainers.image.source=${SOURCE_REPOSITORY} \
      org.opencontainers.image.version=${VERSION}
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-proto=throw \
    TZ=UTC
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /workspace
STOPSIGNAL SIGTERM

FROM runtime-base AS api
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /workspace/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /workspace/packages/types/dist ./packages/types/dist
COPY --from=build --chown=node:node /workspace/packages/types/package.json ./packages/types/package.json
RUN find . -type f -name '*.map' -delete
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/health/live || exit 1
CMD ["node", "apps/api/dist/main.js"]

FROM runtime-base AS worker
ENV WORKER_HEALTH_FILE=/tmp/atlas-worker-ready
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /workspace/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /workspace/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /workspace/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /workspace/packages/types/dist ./packages/types/dist
COPY --from=build --chown=node:node /workspace/packages/types/package.json ./packages/types/package.json
RUN find . -type f -name '*.map' -delete
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node apps/worker/dist/healthcheck.js
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime-base AS migration
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /workspace/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=node:node /workspace/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /workspace/packages/database/drizzle ./packages/database/drizzle
COPY --from=build --chown=node:node /workspace/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/domain/package.json ./packages/domain/package.json
RUN find . -type f -name '*.map' -delete
USER node
CMD ["node", "packages/database/dist/src/cli/migrate.js"]

FROM runtime-base AS web
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/web/server.js"]
