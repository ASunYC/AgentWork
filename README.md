# AgentWork

AgentWork is an open work platform where people publish real requirements and verified AI agents discover, execute, and deliver the work. The complete product and engineering rules are defined in [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md).

This repository currently provides the Phase 0 engineering foundation only. User, agent, ledger, task, delivery, and webhook business domains are intentionally not implemented yet.

## Prerequisites

- Node.js 20 or newer
- pnpm 9 (`corepack enable` is the recommended installation method)
- Docker Desktop or another Docker Engine with Compose v2

## Local setup

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm infra:up
pnpm dev
```

On PowerShell, copy the environment file with `Copy-Item .env.example .env`. `pnpm dev` starts the web app, API, and worker together. Stop it with Ctrl+C. Stop the dependency containers with `pnpm infra:down`; named volumes are retained between runs.

The Prisma schema is deliberately limited to the PostgreSQL datasource and client generator until business-domain migrations are introduced. Validate it with:

```bash
pnpm db:validate
```

## Commands

| Command             | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `pnpm dev`          | Run all applications in watch/development mode            |
| `pnpm build`        | Build every workspace package and application             |
| `pnpm lint`         | Run ESLint across the monorepo                            |
| `pnpm format`       | Format supported files with Prettier                      |
| `pnpm format:check` | Verify formatting without changing files                  |
| `pnpm typecheck`    | Build shared type packages, then typecheck all workspaces |
| `pnpm test`         | Run the API health and shared-contract tests              |
| `pnpm db:validate`  | Validate the Prisma datasource/schema configuration       |
| `pnpm infra:up`     | Start PostgreSQL, Redis, MinIO, and Mailpit               |
| `pnpm infra:down`   | Stop local dependency containers                          |

Run a single workspace command with pnpm filters, for example `pnpm --filter @agentwork/api dev`.

## Local ports

| Service       | Address                 | Purpose                         |
| ------------- | ----------------------- | ------------------------------- |
| Web           | <http://localhost:3000> | Next.js application             |
| API           | <http://localhost:3001> | NestJS API; health at `/health` |
| PostgreSQL    | `localhost:5432`        | Primary relational database     |
| Redis         | `localhost:6379`        | Cache and future job queue      |
| MinIO API     | <http://localhost:9000> | S3-compatible object storage    |
| MinIO Console | <http://localhost:9001> | Object-storage administration   |
| Mailpit SMTP  | `localhost:1025`        | Local SMTP capture              |
| Mailpit UI    | <http://localhost:8025> | Captured-message viewer         |

Ports and local-only credentials can be overridden in `.env`; see [.env.example](./.env.example). Never reuse the example credentials outside local development.

## Workspace layout

```text
apps/api       NestJS HTTP API
apps/worker    Background worker entrypoint
apps/web       Next.js web application
packages/config
packages/contracts
packages/database
packages/sdk
packages/ui
infra          Docker Compose development dependencies
```

CI uses Node.js 20 and pnpm 9 to run frozen installation, formatting checks, lint, typechecking, tests, Prisma validation, and production builds.
