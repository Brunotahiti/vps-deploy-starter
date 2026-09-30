# syntax=docker/dockerfile:1.7
# ManaResto — Next.js 16 standalone + Prisma 7 — Node 22 Alpine
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat && corepack enable pnpm
# Le postinstall lance `prisma generate` : le schéma et la config Prisma doivent être présents.
# DATABASE_URL factice : nécessaire au chargement de prisma.config.ts, jamais utilisée au build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Identifiant de build (commit) : affiché dans l'application et utilisé pour détecter les nouvelles versions (PWA)
ARG BUILD_ID=
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://build:build@localhost:5432/build BUILD_ID=$BUILD_ID
RUN pnpm prisma generate && pnpm next build

# Image de migration / seed : contient le CLI Prisma et le seed (lancée une fois avant l'app)
FROM node:22-alpine AS migrator
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src/lib ./src/lib
COPY src/server ./src/server
COPY --from=builder /app/src/generated ./src/generated
CMD ["sh", "-c", "pnpm prisma migrate deploy && if [ \"$SEED_DEMO\" = \"true\" ]; then pnpm tsx prisma/seed.ts; fi"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
