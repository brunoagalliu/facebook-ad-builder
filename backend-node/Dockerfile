# Node.js/TypeScript rewrite of the Python backend (see backend/Dockerfile for the
# original). Same Debian base as the Python image for consistency.
FROM node:22-bookworm-slim

WORKDIR /app

# System deps for node-gyp (bcryptjs/pg native bits) + Playwright Chromium is installed
# below via `--with-deps`, which pulls in its own shared-lib requirements automatically
# (the Python image had to list ~15 of these by hand; Playwright's Node CLI does this
# for you against a known-good Debian package list per Playwright version).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
# `prisma generate` only reads the schema (it never connects), but prisma.config.ts's
# env("DATABASE_URL") still needs the var to resolve to *something* — Railway injects
# the real one at runtime, not build time, so a placeholder here is fine.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

# Playwright + Chromium with its OS dependencies
RUN npx playwright install --with-deps chromium

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN mkdir -p uploads

EXPOSE 8000

# Run pending migrations then start the server (mirrors the Python image's
# `alembic upgrade head && uvicorn ...` pattern). `migrate deploy` is idempotent —
# safe to re-run on every deploy. Shell form (not exec/JSON form) is needed here since
# this is two commands chained with `&&`.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
