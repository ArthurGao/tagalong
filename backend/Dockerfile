# The API image (DESIGN §13: Docker on Render). Build from the repo root: docker build -f backend/Dockerfile .
# One stage: the runtime keeps the Prisma CLI, which Render's pre-deploy step runs (prisma migrate deploy).
FROM node:22-slim

# OpenSSL for Prisma's schema engine (migrate deploy).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# pnpm cached where the non-root user can read it.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable

WORKDIR /app
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
# The pinned pnpm (packageManager), fetched once at build time, readable by the runtime user.
RUN corepack install && chmod -R a+rX "$COREPACK_HOME" && chown node:node /app
USER node
COPY --chown=node:node backend/package.json backend/prisma.config.ts backend/
COPY --chown=node:node backend/prisma backend/prisma
# postinstall runs prisma generate, so the schema is copied first.
RUN pnpm install --frozen-lockfile --filter backend

COPY --chown=node:node backend backend
RUN pnpm --filter backend build

WORKDIR /app/backend
ENV NODE_ENV=production PORT=3810
EXPOSE 3810
CMD ["node", "dist/main.js"]
