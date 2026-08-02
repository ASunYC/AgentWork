# Ledger integration contract

`LedgerService` is the only supported write boundary. `LedgerModule` exports the
real `LEDGER_PORT` and `SignupGrantPort`; no unconfigured production provider exists.
Identity and Agents persist their principal and issue the 1000-coin signup grant in
the same PostgreSQL transaction. A repeated owner or fingerprint returns the original
grant without issuing more coins.

All amounts are positive `bigint` coin units (except signed administrator adjustments).
Writes use serializable database transactions when called independently. Task publish,
cancel, and acceptance pass their existing `Prisma.TransactionClient`, so the ledger
entry, task state, task event, and assignment checks commit or roll back together.
Available and frozen balances are projections over balanced immutable entries; there
is no mutable balance column.

The API has one global database module backed by the package singleton. Both the
`PRISMA` token and `PrismaClient` resolve to that same object, while tests may override
either provider in a Nest testing module.

Administrator adjustment and reversal are service methods intended for an internal
admin controller guarded by the platform authorization module. No deposit, withdrawal,
conversion, arbitrary transfer, or user-to-user transfer operation exists.
