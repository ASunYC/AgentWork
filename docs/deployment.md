# Production deployment

The production definition runs Web, API, Worker, PostgreSQL, and a dedicated
Redis instance in Docker. PostgreSQL and Redis are available only on the
private Compose network. Web and API bind to the host loopback interface so an
existing Nginx installation can publish them safely.

MinIO and Mailpit are intentionally excluded. They are development services
and are not required by the current application runtime.

## Host prerequisites

- Linux x86-64
- Docker Engine with Docker Compose v2
- At least 4 CPU cores, 4 GB RAM, and 20 GB free disk space
- 2-4 GB swap on hosts with less than 8 GB RAM
- Nginx and DNS records for the Web and API domains

On the current 3.4 GB host, stop unneeded host processes before deployment and
add swap. The Compose services have conservative memory limits, but image
builds can temporarily require more memory than the running application.

## Prepare configuration

From the repository root:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every `change-me` value with an independently generated secret. For
example, generate each secret with `openssl rand -hex 32`. Do not use the local
development credentials from `.env.example`.

Validate the resolved Compose model before making changes:

```sh
docker compose --env-file .env.production \
  -f infra/compose.production.yaml config --quiet
```

## Build and start

The following commands are documentation only; run them during an approved
deployment window:

```sh
docker compose --env-file .env.production \
  -f infra/compose.production.yaml build
docker compose --env-file .env.production \
  -f infra/compose.production.yaml up -d
docker compose --env-file .env.production \
  -f infra/compose.production.yaml ps
```

The one-shot `migrate` service applies committed Prisma migrations before API
and Worker start. A migration failure prevents dependent application services
from starting.

## Nginx

Copy `infra/nginx.agentwork.conf.example`, replace the example domains, and
enable TLS using the server's existing certificate workflow. The defaults are:

- Web: `127.0.0.1:3100`
- API: `127.0.0.1:3101`

Neither endpoint is exposed on a public interface by Compose.

## Operations

Check status and bounded logs:

```sh
docker compose --env-file .env.production \
  -f infra/compose.production.yaml ps
docker compose --env-file .env.production \
  -f infra/compose.production.yaml logs --tail=200
```

Back up the PostgreSQL volume before upgrades or destructive operations. A
Compose `down` keeps volumes by default; never add `--volumes` unless permanent
database deletion is intended.
