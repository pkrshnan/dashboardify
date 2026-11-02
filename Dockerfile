FROM oven/bun:1.4 AS base
WORKDIR /app
COPY server/package.json server/bun.lock server/
RUN cd server && bun install --frozen-lockfile --production
COPY server/src server/src
COPY web web
ENV PORT=8787 VAULT_PATH=/vault
EXPOSE 8787
USER bun
CMD ["bun", "server/src/index.ts"]
