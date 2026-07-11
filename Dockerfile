# Meridian — single-container Railway / Docker deployment
# Runs portal UI + portal-api + 6 indexers + notifications + oracle + registry + KYB + provisioner (+ optional agent)

FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ nginx supervisor gettext-base curl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

# --- dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps/portal ./apps/portal
COPY infra ./infra
RUN pnpm install --frozen-lockfile

# --- build ---
FROM deps AS build
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm -r run build
RUN pnpm --filter @meridian/portal build

# --- runtime ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV PORTAL_API_PORT=4000
ENV NOTIFICATIONS_PORT=4020
ENV ORACLE_RELAY_PORT=4021
ENV REGISTRY_API_PORT=4022
ENV AGENT_RUNTIME_PORT=4025
ENV KYB_GATEWAY_PORT=8090
ENV PROVISIONER_PORT=8091
ENV KYB_DATA_DIR=/data/kyb
ENV PROVISIONER_DATA_DIR=/data/provisioner

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/apps/portal/dist ./apps/portal/dist
COPY --from=build /app/infra ./infra
COPY docker ./docker

RUN chmod +x /app/docker/entrypoint.sh /app/docker/run-agent-runtime.sh \
  && rm -f /etc/nginx/sites-enabled/default

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1'

CMD ["/app/docker/entrypoint.sh"]
