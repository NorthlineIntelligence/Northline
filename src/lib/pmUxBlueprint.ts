export type PmUxPrinciple = {
  category: string;
  principle: string;
  sourcePattern: "ASANA" | "CLICKUP" | "LINEAR";
  northlineApplication: string;
};

export const PM_UX_BENCHMARK_MAP: PmUxPrinciple[] = [
  {
    category: "Views",
    principle: "Same project data should support List, Board, and Timeline render modes.",
    sourcePattern: "ASANA",
    northlineApplication: "Keep one PM project dataset and switch renderers in workspace.",
  },
  {
    category: "Dashboard",
    principle: "Dashboard is an operational control center, not just reporting.",
    sourcePattern: "CLICKUP",
    northlineApplication: "Command-center widgets must include actionable next steps per client account.",
  },
  {
    category: "Status",
    principle: "Status is incomplete without context on why it changed.",
    sourcePattern: "ASANA",
    northlineApplication: "Capture status updates with rationale and render as timeline events.",
  },
  {
    category: "Navigation",
    principle: "High-frequency actions must be accessible in 1-2 clicks.",
    sourcePattern: "LINEAR",
    northlineApplication: "Top action rails and quick actions on CRM org and PM workspace.",
  },
  {
    category: "Information density",
    principle: "Dense but readable UI with clear hierarchy and fast scan paths.",
    sourcePattern: "LINEAR",
    northlineApplication: "Metric chips + compact cards + sectioned tables for consulting operators.",
  },
  {
    category: "Permissions",
    principle: "Shared core model with view-specific permission layers.",
    sourcePattern: "CLICKUP",
    northlineApplication: "Admin PM and future customer PM should consume shared DTOs with visibility flags.",
  },
];

