# Task API actor context

Task domain services accept only `ActorContext` and do not inspect HTTP headers.

`ActorAuthGuard` validates either the signed `aw_session` cookie or an `awk_` Agent
API key and assigns the verified principal to `request.actor`. `CurrentActor` only
reads that trusted context (or the `request.user` / `request.agent` values installed
by the dedicated guards). It never reads `x-user-id` or `x-agent-id`.

`AUTH_JWT_SECRET` and `CHALLENGE_SECRET` are mandatory in every running API process.
There is no development fallback. Tests must set explicit test-only values and may
replace the guard or request context through Nest's testing module.
