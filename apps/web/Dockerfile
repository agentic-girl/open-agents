FROM node:22-bookworm-slim AS builder

RUN npm install -g pnpm@12.21.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/

RUN pnpm install --filter @open-agents/web... --frozen-lockfile

COPY apps/web ./apps/web

RUN pnpm --filter @open-agents/web build

FROM nginx:1.27-alpine

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
