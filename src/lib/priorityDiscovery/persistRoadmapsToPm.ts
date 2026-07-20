import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PriorityDiscoveryRoadmap, PriorityDiscoveryRoadmapBundleOutput } from "@/lib/priorityDiscovery/generateRoadmaps";

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function composePhaseScopeSummary(roadmap: PriorityDiscoveryRoadmap, phase: PriorityDiscoveryRoadmap["phases"][number]) {
  const sections: string[] = [];
  if (phase.goals.length) sections.push(`Goals:\n${phase.goals.map((g) => `- ${g}`).join("\n")}`);
  if (phase.deliverables.length) {
    sections.push(`Deliverables:\n${phase.deliverables.map((d) => `- ${d}`).join("\n")}`);
  }
  if (phase.milestones.length) {
    sections.push(`Milestones:\n${phase.milestones.map((m) => `- ${m}`).join("\n")}`);
  }
  if (phase.tools.length) sections.push(`Tools:\n${phase.tools.map((t) => `- ${t}`).join("\n")}`);
  if (phase.dependencies.length) {
    sections.push(`Dependencies:\n${phase.dependencies.map((d) => `- ${d}`).join("\n")}`);
  }
  if (phase.risks.length) sections.push(`Risks:\n${phase.risks.map((r) => `- ${r}`).join("\n")}`);
  if (roadmap.readinessPrerequisites.length) {
    sections.push(
      `Readiness prerequisites:\n${roadmap.readinessPrerequisites.map((r) => `- ${r}`).join("\n")}`
    );
  }
  return sections.join("\n\n").trim() || roadmap.executiveSummary.slice(0, 4000);
}

function parseDurationUnit(label: string): { value: number; unit: string } {
  const match = label.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months)/i);
  if (!match) return { value: 3, unit: "weeks" };
  return { value: Number(match[1]), unit: match[2].toLowerCase() };
}

export async function persistPriorityDiscoveryRoadmaps(args: {
  assessmentId: string;
  organizationId: string;
  priorityAnalysisId: string;
  bundle: PriorityDiscoveryRoadmapBundleOutput;
  aiModelUsed: string | null;
  replaceExisting?: boolean;
}) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    if (args.replaceExisting) {
      const existingBundles = await tx.priorityDiscoveryRoadmapBundle.findMany({
        where: { assessment_id: args.assessmentId },
        select: { pm_project_ids_json: true },
      });
      const projectIds = existingBundles.flatMap((bundle) => {
        if (!Array.isArray(bundle.pm_project_ids_json)) return [];
        return bundle.pm_project_ids_json.map((id) => String(id)).filter(Boolean);
      });
      if (projectIds.length) {
        await tx.pmProject.deleteMany({
          where: {
            id: { in: projectIds },
            organization_id: args.organizationId,
            assessment_id: args.assessmentId,
          },
        });
      }
    }

    const pmProjectIds: string[] = [];

    for (const roadmap of args.bundle.roadmaps) {
      let cursor = now;
      const sprints = roadmap.phases.map((phase, index) => {
        const days = Math.max(7, phase.durationDays || 21);
        const start = cursor;
        const end = addDays(start, days);
        cursor = end;
        const timeline = parseDurationUnit(phase.durationLabel);
        return {
          sprint_number: index + 1,
          title: phase.title.slice(0, 200),
          stage_label: phase.deliverables[0]?.slice(0, 120) ?? phase.title.slice(0, 120),
          cost_band: null,
          scope_summary: composePhaseScopeSummary(roadmap, phase),
          estimated_duration_value: timeline.value,
          estimated_duration_unit: timeline.unit,
          estimated_completion_date: end,
          target_start_at: start,
          target_end_at: end,
          completion_pct: 0,
          status: "NOT_STARTED" as const,
        };
      });

      const project = await tx.pmProject.create({
        data: {
          organization_id: args.organizationId,
          assessment_id: args.assessmentId,
          title: `#${roadmap.rank} ${roadmap.projectName}`.slice(0, 300),
          status: "PLANNED",
          target_start_at: sprints[0]?.target_start_at ?? now,
          target_end_at: sprints[sprints.length - 1]?.target_end_at ?? addDays(now, 30),
          completion_pct: 0,
          internal_notes: [
            roadmap.executiveSummary,
            roadmap.objectives.length ? `Objectives:\n${roadmap.objectives.map((o) => `- ${o}`).join("\n")}` : "",
            roadmap.firstThirtyDays.length
              ? `First 30 days:\n${roadmap.firstThirtyDays.map((item) => `- ${item}`).join("\n")}`
              : "",
            roadmap.staffingNotes ? `Staffing: ${roadmap.staffingNotes}` : "",
          ]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 20000),
          sprints: { create: sprints },
        },
      });
      pmProjectIds.push(project.id);
    }

    const bundle = await tx.priorityDiscoveryRoadmapBundle.create({
      data: {
        assessment_id: args.assessmentId,
        organization_id: args.organizationId,
        priority_analysis_id: args.priorityAnalysisId,
        ai_model_used: args.aiModelUsed,
        roadmaps_json: args.bundle as unknown as Prisma.InputJsonValue,
        pm_project_ids_json: pmProjectIds as unknown as Prisma.InputJsonValue,
      },
    });

    return { bundle, pmProjectIds };
  });
}
