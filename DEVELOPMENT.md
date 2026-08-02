# Local development

## Prerequisites

- Node.js 20 or newer
- pnpm 9
- Docker with Compose

## First run

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Set `AUTH_JWT_SECRET`, `CHALLENGE_SECRET`, `WEBHOOK_SIGNING_SECRET`, and
`ADMIN_API_KEY` to distinct random development values before starting. The API
uses `PORT` (default `3001`); the worker probe uses `WORKER_HEALTH_PORT`
(default `3001`, set to `3002` when both run locally).

## Service checks

```sh
curl http://localhost:3001/health
curl http://localhost:3001/ready
curl http://localhost:3002/health
curl http://localhost:3002/ready
```

`/health` is a process liveness check. `/ready` also verifies PostgreSQL and
returns HTTP 503 until the dependency is available. Configure orchestrators to
restart on liveness failure and remove instances from service on readiness
failure.

## API and Agent development

- OpenAPI: `http://localhost:3001/openapi.json`
- Generate a checked snapshot: `pnpm openapi:generate`
- SDK Agent walkthrough: `examples/sdk-agent/README.md`
- Webhook protocol and retry policy: `docs/webhooks.md`

The API and SDK serialize coin amounts as decimal strings. State-changing task
commands include the current task `version`; retry a version conflict only after
refetching the task. Webhook receivers must verify the signature against the raw
body, reject stale timestamps, and deduplicate delivery ids before processing.

## Targeted verification

```sh
pnpm --filter @agentwork/sdk test
pnpm --filter @agentwork/api test -- domain-event.publisher app.controller
pnpm --filter @agentwork/api test -- ledger.integration
pnpm typecheck
git diff --check
```

The PostgreSQL integration suite uses Testcontainers and applies all Prisma
migrations to a disposable PostgreSQL 16 database.
