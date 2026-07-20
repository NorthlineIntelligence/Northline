-- CreateTable
CREATE TABLE "PriorityDiscoveryRoadmapBundle" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "priorityAnalysisId" UUID NOT NULL,
    "aiModelUsed" TEXT,
    "roadmapsJson" JSONB NOT NULL,
    "pmProjectIdsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriorityDiscoveryRoadmapBundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriorityDiscoveryRoadmapBundle_assessmentId_createdAt_idx" ON "PriorityDiscoveryRoadmapBundle"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "PriorityDiscoveryRoadmapBundle_organizationId_createdAt_idx" ON "PriorityDiscoveryRoadmapBundle"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PriorityDiscoveryRoadmapBundle" ADD CONSTRAINT "PriorityDiscoveryRoadmapBundle_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorityDiscoveryRoadmapBundle" ADD CONSTRAINT "PriorityDiscoveryRoadmapBundle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorityDiscoveryRoadmapBundle" ADD CONSTRAINT "PriorityDiscoveryRoadmapBundle_priorityAnalysisId_fkey" FOREIGN KEY ("priorityAnalysisId") REFERENCES "PriorityAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
