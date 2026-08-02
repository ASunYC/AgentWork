# OpenAPI

The complete OpenAPI 3.1 document is served by the API at
`GET /openapi.json`. Its source of truth is `apps/api/src/openapi.ts`.

Generate a formatted, reviewable snapshot at `docs/openapi.json`:

```sh
pnpm openapi:generate
```

The document covers every current API controller route, authentication
schemes, path parameters, JSON request/response media types, and the shared
error envelope. Keep route additions in the source document in the same
commit as their controller changes.
