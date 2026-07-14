import type { AnalysisType } from "./types";
import type { TaskType } from "@/lib/ai/taskTypes";

export function analysisTypeToTaskType(analysisType: AnalysisType): TaskType {
  switch (analysisType) {
    case "Executive Summary":
      return "executive_summary";
    case "Operational Risk Review":
      return "risk_review";
    case "Workflow Gap Analysis":
      return "workflow_gap_analysis";
    case "High-Value Opportunity Map":
    case "Low / Medium / High Effort Roadmap":
      return "opportunity_roadmap";
    case "Systems Fragmentation Review":
      return "assessment_analysis";
    case "Implementation Plan":
      return "implementation_plan";
    case "Custom Prompt":
    default:
      return "custom_prompt";
  }
}
