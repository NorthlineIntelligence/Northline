import type { CrmPipelineStage } from "@prisma/client";

export type { CrmPipelineStage };

export const CRM_PIPELINE_ORDER: CrmPipelineStage[] = [
  "NEW_PROSPECT",
  "CONSULTATION",
  "ASSESSMENT_ACTIVE",
  "ASSESSMENT_COMPLETE",
  "WORKSHOP_SCHEDULED",
  "WORKSHOP_CONDUCTED",
  "QUOTE_DRAFTED",
  "QUOTE_DELIVERED",
  "QUOTE_ACCEPTED",
];

export const CRM_STAGE_LABEL: Record<CrmPipelineStage, string> = {
  NEW_PROSPECT: "New prospect",
  CONSULTATION: "Consultation",
  ASSESSMENT_ACTIVE: "Assessment",
  ASSESSMENT_COMPLETE: "Assessment complete",
  WORKSHOP_SCHEDULED: "Workshop scheduled",
  WORKSHOP_CONDUCTED: "Workshop conducted",
  QUOTE_DRAFTED: "Project scope & quote created",
  QUOTE_DELIVERED: "Scope & quote delivered",
  QUOTE_ACCEPTED: "Proposal accepted",
};

export function crmStageStepIndex(stage: CrmPipelineStage): number {
  return CRM_PIPELINE_ORDER.indexOf(stage);
}

/** Follow-up is overdue when past due and the deal is not closed-won. */
export function isCrmFollowUpOverdue(
  nextFollowUp: Date | string | null | undefined,
  stage: CrmPipelineStage
): boolean {
  if (stage === "QUOTE_ACCEPTED") return false;
  if (!nextFollowUp) return false;
  const t = typeof nextFollowUp === "string" ? new Date(nextFollowUp) : nextFollowUp;
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() < Date.now();
}

export function isInvoiceOverdue(
  dueDate: Date | string | null | undefined,
  status: string
): boolean {
  const s = (status ?? "").toUpperCase();
  if (s === "PAID" || s === "VOID") return false;
  if (!dueDate) return false;
  const t = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() < Date.now();
}
