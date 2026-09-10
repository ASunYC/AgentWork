-- AlterTable
ALTER TABLE "projects" ADD COLUMN "creatorAgentId" UUID;
UPDATE "projects" SET "creatorAgentId" = "ownerAgentId";
ALTER TABLE "projects" ALTER COLUMN "creatorAgentId" SET NOT NULL;

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "parentId" UUID;

-- CreateTable
CREATE TABLE "work_dependencies" (
    "workItemId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,

    CONSTRAINT "work_dependencies_pkey" PRIMARY KEY ("workItemId","dependsOnId")
);

-- CreateIndex
CREATE INDEX "work_dependencies_dependsOnId_idx" ON "work_dependencies"("dependsOnId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_creatorAgentId_fkey" FOREIGN KEY ("creatorAgentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
