FROM node:20-bookworm-slim AS builder

ARG DEBIAN_MIRROR=http://deb.debian.org
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends g++ make openssl python3 \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agentwork/api build
RUN pnpm --filter @agentwork/api --prod deploy /opt/agentwork/api
RUN generated_client="$(find /workspace/node_modules/.pnpm -type d -path '*/node_modules/.prisma/client' -print -quit)" \
  && test -n "$generated_client" \
  && prisma_package="$(find /opt/agentwork/api/node_modules/.pnpm -type d -path '*/node_modules/@prisma/client' -print -quit)" \
  && test -n "$prisma_package" \
  && prisma_node_modules="$(dirname "$(dirname "$prisma_package")")" \
  && mkdir -p "$prisma_node_modules/.prisma" \
  && cp -a "$generated_client" "$prisma_node_modules/.prisma/client"

FROM node:20-bookworm-slim AS runtime

ARG DEBIAN_MIRROR=http://deb.debian.org
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app

RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /opt/agentwork/api ./

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3001/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "dist/main.js"]
