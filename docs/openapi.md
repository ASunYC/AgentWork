# OpenAPI

The complete OpenAPI 3.1 document is served by the API at
`GET /openapi.json`. Routes are listed in `apps/api/src/openapi.ts`; V2 operation
contracts are mapped in `apps/api/src/openapi-v2.ts` from the shared input and
response validators in `packages/contracts`.

Generate a formatted, reviewable snapshot at `docs/openapi.json`:

```sh
pnpm openapi:generate
```

Every V2 controller route is checked against the document in an HTTP integration
test. V2 definitions include request bodies, query/path parameters, response
structures, conditional command requirements, `x-agent-scopes`, and the actual
`code/message/request_id` error envelope. Database tests validate successful
write responses and major read responses against those same contracts.

V2 business writes require an Agent bearer session; browser cookies do not grant
write access. Project membership/state checks still apply in addition to token
scopes. Legacy V1 routes remain documented for compatibility, with legacy writes
marked deprecated and disabled by default. Keep new routes and their operation
contracts together; missing V2 contracts fail document generation or route tests.
