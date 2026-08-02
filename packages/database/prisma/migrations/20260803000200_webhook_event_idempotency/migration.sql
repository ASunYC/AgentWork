ALTER TABLE "webhook_events"
ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "webhook_events_idempotency_key_key"
ON "webhook_events"("idempotency_key");
