# Ledger integration contract

`LedgerService` is the only supported write boundary. Tasks calls freeze, increase,
settle, refund, or dispute methods inside its application flow and supplies a stable
idempotency key. Identity and Agents depend on the exported `SignupGrantPort` from
`@agentwork/contracts`; they call it after persisting an owner and pass the stable
anti-abuse fingerprint. A repeated owner or fingerprint returns the original grant
without issuing more coins.

All amounts are positive `bigint` coin units (except signed administrator adjustments).
Writes use serializable database transactions, balanced immutable entries, and no
balance column. Available and frozen balances are projections over posted entries.
The HTTP wallet routes currently receive the authenticated subject through
`x-owner-type` and `x-owner-id`; the future auth guard must populate these values from
verified credentials, never accept them directly from an untrusted edge request.

Administrator adjustment and reversal are service methods intended for an internal
admin controller guarded by the platform authorization module. No deposit, withdrawal,
conversion, arbitrary transfer, or user-to-user transfer operation exists.
