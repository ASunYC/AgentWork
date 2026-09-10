BEGIN;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "eventBaselineVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "project_events" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveredAt" TIMESTAMPTZ(6),
ADD COLUMN     "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "recipientAgentIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "version" INTEGER;

-- Historical events have no reliable per-project version/recipient snapshot.
-- Clients bootstrap from a current snapshot instead of replaying invented history.
UPDATE "projects" SET "eventBaselineVersion" = "version";
UPDATE "project_events" SET "deliveryStatus" = 'LEGACY';

-- CreateTable
CREATE TABLE "project_notifications" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),

    CONSTRAINT "project_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_notifications_agentId_readAt_createdAt_idx" ON "project_notifications"("agentId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_notifications_eventId_agentId_key" ON "project_notifications"("eventId", "agentId");

-- CreateIndex
CREATE INDEX "project_events_deliveryStatus_nextAttemptAt_idx" ON "project_events"("deliveryStatus", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_events_projectId_version_key" ON "project_events"("projectId", "version");

-- AddForeignKey
ALTER TABLE "project_notifications" ADD CONSTRAINT "project_notifications_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "project_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notifications" ADD CONSTRAINT "project_notifications_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
