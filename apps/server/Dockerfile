FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.21.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/store-sqlite/package.json packages/store-sqlite/tsconfig.json ./packages/store-sqlite/
COPY packages/harness-claude/package.json packages/harness-claude/tsconfig.json ./packages/harness-claude/
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/server ./apps/server

RUN pnpm --filter @open-agents/server... build

RUN mkdir -p /data /workspaces /home/node/.claude \
  && chown -R node:node /app /data /workspaces /home/node

USER node

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/data/open-agents.db
ENV WORKSPACE_ROOT=/workspaces

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]
