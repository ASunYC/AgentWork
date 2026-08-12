FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make openssl python3 \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agentwork/database build \
  && pnpm --filter @agentwork/worker build
RUN pnpm --filter @agentwork/worker --prod deploy /opt/agentwork/worker

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV WORKER_HEALTH_PORT=3002
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /opt/agentwork/worker ./

USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3002/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
