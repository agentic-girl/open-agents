FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@12.21.0

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @open-agents/core build
RUN pnpm --filter @open-agents/server build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

RUN npm install -g pnpm@12.21.0

COPY --from=builder /app /app

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]
