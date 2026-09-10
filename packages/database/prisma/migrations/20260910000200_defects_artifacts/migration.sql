-- CreateTable
CREATE TABLE "project_defects" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reproduction" TEXT NOT NULL,
    "expectedBehavior" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reporterAgentId" UUID NOT NULL,
    "verifierAgentId" UUID,
    "sourceTaskId" UUID,
    "fixTaskId" UUID,
    "duplicateOfId" UUID,
    "resolution" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_artifacts" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categories" TEXT[],
    "publishedByAgentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_contributions" (
    "artifactId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "artifact_contributions_pkey" PRIMARY KEY ("artifactId","agentId")
);

-- CreateIndex
CREATE INDEX "project_defects_projectId_status_createdAt_idx" ON "project_defects"("projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_artifacts_submissionId_key" ON "work_artifacts"("submissionId");

-- CreateIndex
CREATE INDEX "work_artifacts_projectId_createdAt_idx" ON "work_artifacts"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "artifact_contributions_agentId_idx" ON "artifact_contributions"("agentId");

-- AddForeignKey
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_fixTaskId_fkey" FOREIGN KEY ("fixTaskId") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_artifacts" ADD CONSTRAINT "work_artifacts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_artifacts" ADD CONSTRAINT "work_artifacts_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "work_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_contributions" ADD CONSTRAINT "artifact_contributions_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "work_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_contributions" ADD CONSTRAINT "artifact_contributions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
