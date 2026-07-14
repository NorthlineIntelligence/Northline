/** Private AI Workbench domain types — future Prisma/Supabase models should mirror these. */

export type ClientWorkspaceStatus =
  | "Discovery"
  | "Assessment"
  | "Roadmap"
  | "Implementation"
  | "Complete";

export type DocumentProcessingStatus = "Uploaded" | "Processing" | "Indexed" | "Failed";

export type DocumentFileType = "PDF" | "DOCX" | "TXT" | "CSV" | "XLSX";

export type OutputType =
  | "Executive Readout"
  | "Risk Register"
  | "Workflow Map"
  | "Opportunity Roadmap"
  | "Implementation Plan"
  | "Client Notes";

export type OutputStatus = "Draft" | "Reviewed" | "Final";

export type AnalysisType =
  | "Executive Summary"
  | "Operational Risk Review"
  | "Workflow Gap Analysis"
  | "High-Value Opportunity Map"
  | "Low / Medium / High Effort Roadmap"
  | "Systems Fragmentation Review"
  | "Implementation Plan"
  | "Custom Prompt";

export type AuditActionStatus = "Success" | "Pending" | "Failed" | "Requires Approval";

export interface ClientWorkspace {
  id: string;
  name: string;
  industry: string;
  businessSize: string;
  notes: string;
  status: ClientWorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  documentIds: string[];
  assessmentIds: string[];
  outputIds: string[];
}

export interface WorkbenchDocument {
  id: string;
  name: string;
  fileType: DocumentFileType;
  uploadedAt: string;
  clientId: string;
  processingStatus: DocumentProcessingStatus;
  sizeBytes: number;
  /** Placeholder for future chunk/embedding counts (Qdrant) */
  chunkCount?: number;
}

export interface WorkbenchAssessment {
  id: string;
  clientId: string;
  title: string;
  analysisType: AnalysisType;
  status: "Draft" | "Running" | "Complete";
  createdAt: string;
}

export interface WorkbenchOutput {
  id: string;
  title: string;
  clientId: string;
  type: OutputType;
  createdAt: string;
  status: OutputStatus;
  contentPreview: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  clientId: string | null;
  clientName: string | null;
  action: string;
  objectType: string;
  status: AuditActionStatus;
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  description: string;
  clientName?: string;
  kind: "document" | "assessment" | "output" | "client" | "system";
}

export interface WorkbenchDashboardStats {
  totalClients: number;
  uploadedDocuments: number;
  completedAssessments: number;
  draftExecutiveReports: number;
}

export const ANALYSIS_TYPES: AnalysisType[] = [
  "Executive Summary",
  "Operational Risk Review",
  "Workflow Gap Analysis",
  "High-Value Opportunity Map",
  "Low / Medium / High Effort Roadmap",
  "Systems Fragmentation Review",
  "Implementation Plan",
  "Custom Prompt",
];

export const ACCEPTED_DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".txt", ".csv", ".xlsx"] as const;

export const CLIENT_STATUS_OPTIONS: ClientWorkspaceStatus[] = [
  "Discovery",
  "Assessment",
  "Roadmap",
  "Implementation",
  "Complete",
];
