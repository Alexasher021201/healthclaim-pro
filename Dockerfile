# ==============================================================================
# HealthClaim Pro - Enterprise Single-Container Multi-Stage Production Build
# ==============================================================================

# Stage 1: Build & Compile all monorepo workspaces
FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl
RUN npm install -g pnpm@10.33.0

# Copy workspace definitions and package files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy Prisma schema & generate client
COPY backend/prisma ./backend/prisma
RUN cd backend && pnpm prisma:generate

# Copy full source trees
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

# Compile shared, frontend and backend
RUN pnpm -r build

# Stage 2: Lean Production Runtime Image
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache libc6-compat openssl

# Create non-root system user (Least Privilege Security Standard)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy runtime node_modules and Prisma artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/package.json ./package.json

# Copy compiled frontend SPA to backend/public
COPY --from=builder /app/frontend/dist ./backend/public

# Set ownership
RUN chown -R nestjs:nodejs /app

USER nestjs
WORKDIR /app/backend

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
