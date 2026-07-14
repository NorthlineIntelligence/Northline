/**
 * Mock data layer for Private AI Workbench.
 * TODO: Replace with Prisma queries + Supabase Storage metadata when tables exist.
 */

import type {
  ActivityItem,
  AuditLogEntry,
  ClientWorkspace,
  WorkbenchAssessment,
  WorkbenchDashboardStats,
  WorkbenchDocument,
  WorkbenchOutput,
} from "./types";

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86400000).toISOString();

export const MOCK_CLIENTS: ClientWorkspace[] = [
  {
    id: "cli-aurora",
    name: "Aurora Manufacturing Group",
    industry: "Industrial Manufacturing",
    businessSize: "Mid-Market (500–2,500)",
    notes: "ERP modernization initiative; sensitive operational data.",
    status: "Assessment",
    createdAt: daysAgo(42),
    updatedAt: daysAgo(1),
    documentIds: ["doc-aurora-1", "doc-aurora-2"],
    assessmentIds: ["asm-aurora-1"],
    outputIds: ["out-aurora-1"],
  },
  {
    id: "cli-meridian",
    name: "Meridian Health Partners",
    industry: "Healthcare Services",
    businessSize: "Enterprise (2,500+)",
    notes: "HIPAA-sensitive workflows; human approval required for exports.",
    status: "Roadmap",
    createdAt: daysAgo(28),
    updatedAt: daysAgo(3),
    documentIds: ["doc-meridian-1"],
    assessmentIds: ["asm-meridian-1", "asm-meridian-2"],
    outputIds: ["out-meridian-1", "out-meridian-2"],
  },
  {
    id: "cli-summit",
    name: "Summit Capital Advisors",
    industry: "Financial Services",
    businessSize: "Boutique (< 100)",
    notes: "Discovery phase — document collection in progress.",
    status: "Discovery",
    createdAt: daysAgo(7),
    updatedAt: daysAgo(2),
    documentIds: [],
    assessmentIds: [],
    outputIds: [],
  },
  {
    id: "cli-northwind",
    name: "Northwind Logistics",
    industry: "Supply Chain & Logistics",
    businessSize: "Mid-Market (500–2,500)",
    notes: "Implementation tracking for WMS + TMS integration.",
    status: "Implementation",
    createdAt: daysAgo(90),
    updatedAt: daysAgo(0),
    documentIds: ["doc-northwind-1", "doc-northwind-2", "doc-northwind-3"],
    assessmentIds: ["asm-northwind-1"],
    outputIds: ["out-northwind-1", "out-northwind-2", "out-northwind-3"],
  },
];

export const MOCK_DOCUMENTS: WorkbenchDocument[] = [
  {
    id: "doc-aurora-1",
    name: "Operations Playbook 2025.pdf",
    fileType: "PDF",
    uploadedAt: daysAgo(5),
    clientId: "cli-aurora",
    processingStatus: "Indexed",
    sizeBytes: 2_400_000,
    chunkCount: 128,
  },
  {
    id: "doc-aurora-2",
    name: "ERP Gap Assessment.xlsx",
    fileType: "XLSX",
    uploadedAt: daysAgo(2),
    clientId: "cli-aurora",
    processingStatus: "Processing",
    sizeBytes: 890_000,
  },
  {
    id: "doc-meridian-1",
    name: "Clinical Workflow Map.docx",
    fileType: "DOCX",
    uploadedAt: daysAgo(10),
    clientId: "cli-meridian",
    processingStatus: "Indexed",
    sizeBytes: 1_100_000,
    chunkCount: 64,
  },
  {
    id: "doc-northwind-1",
    name: "TMS Integration Requirements.pdf",
    fileType: "PDF",
    uploadedAt: daysAgo(20),
    clientId: "cli-northwind",
    processingStatus: "Indexed",
    sizeBytes: 3_200_000,
    chunkCount: 210,
  },
  {
    id: "doc-northwind-2",
    name: "Carrier SLA Exceptions.csv",
    fileType: "CSV",
    uploadedAt: daysAgo(15),
    clientId: "cli-northwind",
    processingStatus: "Indexed",
    sizeBytes: 45_000,
    chunkCount: 12,
  },
  {
    id: "doc-northwind-3",
    name: "Legacy SOP Archive.txt",
    fileType: "TXT",
    uploadedAt: daysAgo(1),
    clientId: "cli-northwind",
    processingStatus: "Failed",
    sizeBytes: 12_000,
  },
];

export const MOCK_ASSESSMENTS: WorkbenchAssessment[] = [
  {
    id: "asm-aurora-1",
    clientId: "cli-aurora",
    title: "Operational Risk Review — Q1",
    analysisType: "Operational Risk Review",
    status: "Complete",
    createdAt: daysAgo(3),
  },
  {
    id: "asm-meridian-1",
    clientId: "cli-meridian",
    title: "Workflow Gap Analysis",
    analysisType: "Workflow Gap Analysis",
    status: "Complete",
    createdAt: daysAgo(12),
  },
  {
    id: "asm-meridian-2",
    clientId: "cli-meridian",
    title: "Executive Summary — Board Readout",
    analysisType: "Executive Summary",
    status: "Draft",
    createdAt: daysAgo(1),
  },
  {
    id: "asm-northwind-1",
    clientId: "cli-northwind",
    title: "Implementation Plan — TMS Phase 2",
    analysisType: "Implementation Plan",
    status: "Complete",
    createdAt: daysAgo(8),
  },
];

export const MOCK_OUTPUTS: WorkbenchOutput[] = [
  {
    id: "out-aurora-1",
    title: "Executive Readout — Manufacturing Ops",
    clientId: "cli-aurora",
    type: "Executive Readout",
    createdAt: daysAgo(2),
    status: "Draft",
    contentPreview:
      "Key finding: fragmented shop-floor data capture creates 18–24 hour reporting lag. Recommended phased MES overlay with governed master data...",
  },
  {
    id: "out-meridian-1",
    title: "Clinical Workflow Risk Register",
    clientId: "cli-meridian",
    type: "Risk Register",
    createdAt: daysAgo(11),
    status: "Reviewed",
    contentPreview:
      "14 operational risks identified across intake, scheduling, and claims handoff. Three require immediate mitigation (severity: high)...",
  },
  {
    id: "out-meridian-2",
    title: "Opportunity Roadmap — Revenue Cycle",
    clientId: "cli-meridian",
    type: "Opportunity Roadmap",
    createdAt: daysAgo(4),
    status: "Final",
    contentPreview:
      "Prioritized initiatives mapped to effort bands. Quick wins: prior auth automation, denial analytics dashboard...",
  },
  {
    id: "out-northwind-1",
    title: "TMS Integration Workflow Map",
    clientId: "cli-northwind",
    type: "Workflow Map",
    createdAt: daysAgo(18),
    status: "Final",
    contentPreview:
      "End-to-end carrier booking flow with exception paths. Integration touchpoints: WMS, ERP, carrier APIs...",
  },
  {
    id: "out-northwind-2",
    title: "Phase 2 Implementation Plan",
    clientId: "cli-northwind",
    type: "Implementation Plan",
    createdAt: daysAgo(7),
    status: "Reviewed",
    contentPreview:
      "12-week rollout with governance gates. Dependencies: data migration, UAT sign-off, training cohorts...",
  },
  {
    id: "out-northwind-3",
    title: "Steering Committee Notes",
    clientId: "cli-northwind",
    type: "Client Notes",
    createdAt: daysAgo(0),
    status: "Draft",
    contentPreview:
      "Sponsor confirmed budget for Q3. Open item: finalize carrier API credentials and security review...",
  },
];

export const MOCK_AUDIT_LOG: AuditLogEntry[] = [
  {
    id: "aud-1",
    timestamp: daysAgo(0),
    user: "consultant@northline.io",
    clientId: "cli-northwind",
    clientName: "Northwind Logistics",
    action: "Generated implementation plan output",
    objectType: "Output",
    status: "Success",
  },
  {
    id: "aud-2",
    timestamp: daysAgo(1),
    user: "consultant@northline.io",
    clientId: "cli-aurora",
    clientName: "Aurora Manufacturing Group",
    action: "Uploaded ERP Gap Assessment.xlsx",
    objectType: "Document",
    status: "Success",
  },
  {
    id: "aud-3",
    timestamp: daysAgo(1),
    user: "consultant@northline.io",
    clientId: "cli-meridian",
    clientName: "Meridian Health Partners",
    action: "Export executive readout (PDF)",
    objectType: "Output",
    status: "Requires Approval",
  },
  {
    id: "aud-4",
    timestamp: daysAgo(2),
    user: "consultant@northline.io",
    clientId: "cli-aurora",
    clientName: "Aurora Manufacturing Group",
    action: "Ran Operational Risk Review analysis",
    objectType: "Assessment",
    status: "Success",
  },
  {
    id: "aud-5",
    timestamp: daysAgo(3),
    user: "admin@northline.io",
    clientId: null,
    clientName: null,
    action: "Updated private LLM connector settings",
    objectType: "Settings",
    status: "Success",
  },
  {
    id: "aud-6",
    timestamp: daysAgo(5),
    user: "consultant@northline.io",
    clientId: "cli-summit",
    clientName: "Summit Capital Advisors",
    action: "Created client workspace",
    objectType: "Client",
    status: "Success",
  },
];

export const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: "act-1",
    timestamp: daysAgo(0),
    description: "Draft steering committee notes saved",
    clientName: "Northwind Logistics",
    kind: "output",
  },
  {
    id: "act-2",
    timestamp: daysAgo(1),
    description: "ERP Gap Assessment uploaded — processing started",
    clientName: "Aurora Manufacturing Group",
    kind: "document",
  },
  {
    id: "act-3",
    timestamp: daysAgo(1),
    description: "Executive Summary analysis queued",
    clientName: "Meridian Health Partners",
    kind: "assessment",
  },
  {
    id: "act-4",
    timestamp: daysAgo(2),
    description: "Operational Risk Review completed",
    clientName: "Aurora Manufacturing Group",
    kind: "assessment",
  },
  {
    id: "act-5",
    timestamp: daysAgo(7),
    description: "Summit Capital Advisors workspace created",
    clientName: "Summit Capital Advisors",
    kind: "client",
  },
];

export function getDashboardStats(): WorkbenchDashboardStats {
  return {
    totalClients: MOCK_CLIENTS.length,
    uploadedDocuments: MOCK_DOCUMENTS.length,
    completedAssessments: MOCK_ASSESSMENTS.filter((a) => a.status === "Complete").length,
    draftExecutiveReports: MOCK_OUTPUTS.filter(
      (o) => o.type === "Executive Readout" && o.status === "Draft"
    ).length,
  };
}

export function getClientById(id: string): ClientWorkspace | undefined {
  return MOCK_CLIENTS.find((c) => c.id === id);
}

export function getDocumentsForClient(clientId: string): WorkbenchDocument[] {
  return MOCK_DOCUMENTS.filter((d) => d.clientId === clientId);
}

export function getAssessmentsForClient(clientId: string): WorkbenchAssessment[] {
  return MOCK_ASSESSMENTS.filter((a) => a.clientId === clientId);
}

export function getOutputsForClient(clientId: string): WorkbenchOutput[] {
  return MOCK_OUTPUTS.filter((o) => o.clientId === clientId);
}

export function getClientName(clientId: string): string {
  return MOCK_CLIENTS.find((c) => c.id === clientId)?.name ?? "Unknown client";
}
