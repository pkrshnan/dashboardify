# dashboardify server. Built by the home server's docker compose project (pkrshnan/homeserver).
ARG BUN_VERSION=1.4.4
FROM oven/bun:${BUN_VERSION}-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production \
    PORT=8787 \
    VAULT_PATH=/data/vault \
    HEALTH_RAW_PATH=/data/health-raw \
    HEALTH_DERIVED_PATH=/data/health-derived
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "src/main.ts"]
