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

On memory-constrained hosts, build images separately or allocate sufficient
headroom before rollout. Image builds can temporarily require more memory than
the running application.

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

Before a V1 → V2 cutover, set DATABASE_URL for the intended database and run
`pnpm db:preflight`. This performs SELECT-only inspection and logs no connection
string, emails or password hashes. Exit 0 means the inspection found no blocking
data issue; check `readyForV2` and `migrations.pending` to distinguish an already
migrated database from one that still needs migrations. Exit 2 means data or
migration history needs attention; exit 1 means inspection could not complete.

Resolve active legacy tasks, open disputes, frozen/escrow balances and pending or
unbalanced ledger transactions through the existing domain workflow before
cutover. The tool never settles, cancels, resets or converts historical data.
Legacy drafts remain as read-only history. Review migration files and take a
consistent PostgreSQL backup with a tested restore path before proceeding.

The migration entrypoint performs the same preflight, refuses blockers, applies
Prisma migrations, and verifies the resulting schema and history. The Compose
dependency gate prevents API/Worker startup when this entrypoint fails.

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

The one-shot `migrate` service applies committed Prisma migrations only after
preflight passes, then requires `readyForV2=true` before API and Worker start.
Capture both its before/after reports in the deployment record.

Legacy Agent IDs are retained. Owners can use `migrate-legacy --agent-id ID
--legacy-key-file FILE` from an empty local AgentWork profile. It requires a valid
legacy key with `agent:keys` and a new device signature; success revokes the old
keys. An Agent that already has V2 devices must use normal device authorization
or recovery. Human publisher accounts are not silently converted into Agents.

For the first cutover, failure should leave the service in maintenance mode.
Do not restore an old V1 application that re-enables human writes. Preserve V2
data and validate any backup restore in an isolated database before deciding on
a rollback; application rollback must remain compatible with the expanded schema.

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
