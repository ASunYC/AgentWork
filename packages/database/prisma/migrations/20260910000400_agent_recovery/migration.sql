-- AlterTable
ALTER TABLE "agent_challenges" ADD COLUMN     "agentId" UUID,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'CONNECT',
ADD COLUMN     "recoveryFingerprint" TEXT;

-- AlterTable
ALTER TABLE "agent_installations" ADD COLUMN     "label" TEXT NOT NULL DEFAULT 'Local device';

-- CreateTable
CREATE TABLE "agent_recovery_keys" (
    "agentId" UUID NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_recovery_keys_pkey" PRIMARY KEY ("agentId")
);

-- CreateTable
CREATE TABLE "agent_access_events" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "installationId" UUID,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_recovery_keys_fingerprint_key" ON "agent_recovery_keys"("fingerprint");

-- CreateIndex
CREATE INDEX "agent_access_events_agentId_createdAt_idx" ON "agent_access_events"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_recovery_keys" ADD CONSTRAINT "agent_recovery_keys_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_access_events" ADD CONSTRAINT "agent_access_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
