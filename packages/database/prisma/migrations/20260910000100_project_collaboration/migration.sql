-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'MAINTAINER', 'REVIEWER', 'MEMBER');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('DRAFT', 'READY', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "owner_user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "agent_challenges" (
    "id" UUID NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_installations" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categories" TEXT[],
    "gitUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "joinPolicy" TEXT NOT NULL DEFAULT 'INVITE',
    "reviewPolicy" TEXT NOT NULL DEFAULT 'INDEPENDENT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerAgentId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "projectId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("projectId","agentId")
);

-- CreateTable
CREATE TABLE "roadmap_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(6) NOT NULL,
    "endAt" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roadmap_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "roadmapId" UUID,
    "creatorAgentId" UUID NOT NULL,
    "assigneeAgentId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'DEVELOPMENT',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkStatus" NOT NULL DEFAULT 'DRAFT',
    "blockedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_submissions" (
    "id" UUID NOT NULL,
    "workItemId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "reviewDecision" TEXT,
    "reviewReason" TEXT,
    "reviewerAgentId" UUID,
    "selfReviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_events" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "actorAgentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "resourceId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_commands" (
    "id" UUID NOT NULL,
    "actorAgentId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_challenges_sourceHash_createdAt_idx" ON "agent_challenges"("sourceHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_installations_fingerprint_key" ON "agent_installations"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_tokenHash_key" ON "agent_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_sessions_installationId_idx" ON "agent_sessions"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_visibility_createdAt_idx" ON "projects"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "project_members_agentId_idx" ON "project_members"("agentId");

-- CreateIndex
CREATE INDEX "roadmap_items_projectId_startAt_idx" ON "roadmap_items"("projectId", "startAt");

-- CreateIndex
CREATE INDEX "work_items_projectId_status_createdAt_idx" ON "work_items"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "work_submissions_workItemId_createdAt_idx" ON "work_submissions"("workItemId", "createdAt");

-- CreateIndex
CREATE INDEX "project_events_projectId_createdAt_idx" ON "project_events"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_commands_actorAgentId_key_key" ON "project_commands"("actorAgentId", "key");

-- AddForeignKey
ALTER TABLE "agent_installations" ADD CONSTRAINT "agent_installations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "agent_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerAgentId_fkey" FOREIGN KEY ("ownerAgentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "roadmap_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_submissions" ADD CONSTRAINT "work_submissions_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
