import { z } from "zod";

export const PRIORITY_ASSESSMENT_TYPE = "priority_discovery";

export const PRIORITY_RESPONSE_TYPES = [
  "FREE_TEXT",
  "LIKERT",
  "RANKING",
  "MULTI_SELECT",
  "FORCED_CHOICE",
  "DEPARTMENT",
  "CONFIDENCE",
  "URGENCY",
] as const;

export const PRIORITY_SCORING_DIMENSIONS = [
  "URGENCY",
  "BUSINESS_IMPACT",
  "FREQUENCY",
  "MANUAL_EFFORT",
  "CUSTOMER_IMPACT",
  "EMPLOYEE_IMPACT",
  "DATA_READINESS",
  "OWNERSHIP_CLARITY",
  "RISK_LEVEL",
  "AI_APPLICABILITY",
  "AUTOMATION_APPLICABILITY",
  "STRATEGIC_ALIGNMENT",
  "CONFIDENCE",
  "RESPONDENT_ALIGNMENT",
] as const;

export type PriorityResponseType = (typeof PRIORITY_RESPONSE_TYPES)[number];
export type PriorityScoringDimension = (typeof PRIORITY_SCORING_DIMENSIONS)[number];

export const PRIORITY_SECTIONS = [
  "Business Pressure",
  "Workflow Friction",
  "Decision Pain",
  "Customer and Employee Impact",
  "Existing AI and Automation Ideas",
  "Priority Tradeoffs",
] as const;

export const PRIORITY_CSV_COLUMNS = [
  "section",
  "questionText",
  "questionHelpText",
  "responseType",
  "options",
  "scaleMin",
  "scaleMax",
  "required",
  "order",
  "tags",
  "scoringDimension",
  "isActive",
] as const;

export type PriorityQuestionInput = {
  id?: string;
  assessmentType?: "readiness" | "priority_discovery";
  questionSetVersion?: string;
  section: string;
  questionText: string;
  questionHelpText?: string | null;
  responseType: PriorityResponseType;
  options?: string[] | null;
  scaleMin?: number | null;
  scaleMax?: number | null;
  scaleLabels?: Record<string, string> | null;
  required: boolean;
  order: number;
  tags?: string[] | null;
  scoringDimension?: PriorityScoringDimension | null;
  isActive: boolean;
};

type PriorityQuestionDraft = Omit<PriorityQuestionInput, "required" | "isActive"> &
  Partial<Pick<PriorityQuestionInput, "required" | "isActive">>;

export const PriorityQuestionInputSchema = z.object({
  id: z.string().uuid().optional(),
  assessmentType: z.enum(["readiness", "priority_discovery"]).optional().default("priority_discovery"),
  questionSetVersion: z.string().min(1).max(50).optional().default("1"),
  section: z.string().min(1).max(200),
  questionText: z.string().min(1).max(8000),
  questionHelpText: z.string().max(8000).nullable().optional(),
  responseType: z.enum(PRIORITY_RESPONSE_TYPES),
  options: z.array(z.string().min(1).max(500)).nullable().optional(),
  scaleMin: z.number().int().min(0).max(100).nullable().optional(),
  scaleMax: z.number().int().min(1).max(100).nullable().optional(),
  scaleLabels: z.record(z.string(), z.string()).nullable().optional(),
  required: z.boolean().default(false),
  order: z.number().int().min(1).max(100000),
  tags: z.array(z.string().min(1).max(100)).nullable().optional(),
  scoringDimension: z.enum(PRIORITY_SCORING_DIMENSIONS).nullable().optional(),
  isActive: z.boolean().default(true),
});

function q(input: PriorityQuestionDraft): PriorityQuestionInput {
  return PriorityQuestionInputSchema.parse({
    assessmentType: "priority_discovery",
    questionSetVersion: "1",
    required: true,
    isActive: true,
    ...input,
  });
}

const pressureOptions = [
  "Revenue growth",
  "Customer retention",
  "Operational efficiency",
  "Employee capacity",
  "Compliance/risk",
  "Customer experience",
  "Data quality",
  "Speed to execution",
  "Cost reduction",
  "Scalability",
];

const outcomeOptions = [
  "Save time",
  "Reduce cost",
  "Increase revenue",
  "Improve customer experience",
  "Reduce risk",
  "Improve employee experience",
  "Improve data quality",
  "Increase speed",
];

export const PRIORITY_DISCOVERY_SEED_QUESTIONS: PriorityQuestionInput[] = [
  q({
    section: "Business Pressure",
    order: 1,
    questionText: "What are the top 3 business problems your team is trying to solve right now?",
    questionHelpText: "Use plain language. Short bullets are fine.",
    responseType: "FREE_TEXT",
    scoringDimension: "BUSINESS_IMPACT",
    tags: ["leadership", "pain-point", "strategy"],
  }),
  q({
    section: "Business Pressure",
    order: 2,
    questionText: "Where is the company losing the most time, money, or momentum?",
    responseType: "FREE_TEXT",
    scoringDimension: "URGENCY",
    tags: ["waste", "momentum"],
  }),
  q({
    section: "Business Pressure",
    order: 3,
    questionText: "What initiatives are most visible to leadership this quarter?",
    responseType: "FREE_TEXT",
    scoringDimension: "STRATEGIC_ALIGNMENT",
    tags: ["leadership", "initiatives"],
  }),
  q({
    section: "Business Pressure",
    order: 4,
    questionText: "Which of these pressures feels most urgent? Choose up to 3.",
    responseType: "MULTI_SELECT",
    options: pressureOptions,
    scoringDimension: "URGENCY",
    tags: ["urgency", "priorities"],
  }),
  q({
    section: "Business Pressure",
    order: 5,
    questionText: "Our current processes allow us to move fast enough to meet business needs.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "BUSINESS_IMPACT",
    tags: ["speed", "process"],
  }),
  q({
    section: "Workflow Friction",
    order: 6,
    questionText: "What tasks or workflows create the most repeated manual work?",
    responseType: "FREE_TEXT",
    scoringDimension: "MANUAL_EFFORT",
    tags: ["manual-work", "automation"],
  }),
  q({
    section: "Workflow Friction",
    order: 7,
    questionText: "Where do handoffs between people, teams, or systems break down?",
    responseType: "FREE_TEXT",
    scoringDimension: "FREQUENCY",
    tags: ["handoffs", "systems"],
  }),
  q({
    section: "Workflow Friction",
    order: 8,
    questionText: "What information do people repeatedly have to search for, recreate, or ask others to provide?",
    responseType: "FREE_TEXT",
    scoringDimension: "MANUAL_EFFORT",
    tags: ["knowledge", "search"],
  }),
  q({
    section: "Workflow Friction",
    order: 9,
    questionText: "Important work often slows down because people cannot easily access the right information.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "FREQUENCY",
    tags: ["information-access"],
  }),
  q({
    section: "Workflow Friction",
    order: 10,
    questionText: "Our team spends too much time on low-value administrative work.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "MANUAL_EFFORT",
    tags: ["admin-work"],
  }),
  q({
    section: "Decision Pain",
    order: 11,
    questionText: "What decisions are currently delayed because data, context, or ownership is unclear?",
    responseType: "FREE_TEXT",
    scoringDimension: "OWNERSHIP_CLARITY",
    tags: ["decisions", "ownership"],
  }),
  q({
    section: "Decision Pain",
    order: 12,
    questionText: "Where would better recommendations, summaries, or alerts help people act faster?",
    responseType: "FREE_TEXT",
    scoringDimension: "AI_APPLICABILITY",
    tags: ["recommendations", "summaries", "alerts"],
  }),
  q({
    section: "Decision Pain",
    order: 13,
    questionText: "What reports, dashboards, or updates are created manually today?",
    responseType: "FREE_TEXT",
    scoringDimension: "AUTOMATION_APPLICABILITY",
    tags: ["reports", "dashboards"],
  }),
  q({
    section: "Decision Pain",
    order: 14,
    questionText: "Leaders have enough visibility into what is working and what is not.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "STRATEGIC_ALIGNMENT",
    tags: ["visibility"],
  }),
  q({
    section: "Decision Pain",
    order: 15,
    questionText: "Teams trust the data they use to make decisions.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "DATA_READINESS",
    tags: ["data-trust"],
  }),
  q({
    section: "Customer and Employee Impact",
    order: 16,
    questionText: "Where do customers experience delays, confusion, or inconsistent service?",
    responseType: "FREE_TEXT",
    scoringDimension: "CUSTOMER_IMPACT",
    tags: ["customer-experience"],
  }),
  q({
    section: "Customer and Employee Impact",
    order: 17,
    questionText: "Where do employees experience frustration, duplicated work, or unnecessary complexity?",
    responseType: "FREE_TEXT",
    scoringDimension: "EMPLOYEE_IMPACT",
    tags: ["employee-experience"],
  }),
  q({
    section: "Customer and Employee Impact",
    order: 18,
    questionText: "What work, if improved, would most noticeably improve customer experience?",
    responseType: "FREE_TEXT",
    scoringDimension: "CUSTOMER_IMPACT",
    tags: ["customer-improvement"],
  }),
  q({
    section: "Customer and Employee Impact",
    order: 19,
    questionText: "What work, if improved, would most noticeably improve employee capacity or morale?",
    responseType: "FREE_TEXT",
    scoringDimension: "EMPLOYEE_IMPACT",
    tags: ["employee-capacity"],
  }),
  q({
    section: "Existing AI and Automation Ideas",
    order: 20,
    questionText: "What AI or automation project do you think the company should explore first?",
    responseType: "FREE_TEXT",
    scoringDimension: "AI_APPLICABILITY",
    tags: ["idea", "pilot"],
  }),
  q({
    section: "Existing AI and Automation Ideas",
    order: 21,
    questionText: "What would success look like if this project worked?",
    responseType: "FREE_TEXT",
    scoringDimension: "BUSINESS_IMPACT",
    tags: ["success"],
  }),
  q({
    section: "Existing AI and Automation Ideas",
    order: 22,
    questionText: "What could go wrong if this project was implemented poorly?",
    responseType: "FREE_TEXT",
    scoringDimension: "RISK_LEVEL",
    tags: ["risk"],
  }),
  q({
    section: "Existing AI and Automation Ideas",
    order: 23,
    questionText: "Who would need to be involved for this project to succeed?",
    responseType: "FREE_TEXT",
    scoringDimension: "OWNERSHIP_CLARITY",
    tags: ["ownership"],
  }),
  q({
    section: "Existing AI and Automation Ideas",
    order: 24,
    questionText: "This project has clear ownership today.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "OWNERSHIP_CLARITY",
    tags: ["ownership"],
  }),
  q({
    section: "Existing AI and Automation Ideas",
    order: 25,
    questionText: "The data/process needed for this project is reliable enough to automate.",
    responseType: "LIKERT",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Strongly disagree", "5": "Strongly agree" },
    scoringDimension: "DATA_READINESS",
    tags: ["data-readiness", "automation"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 26,
    questionText: "Rank these outcomes from most to least important.",
    responseType: "RANKING",
    options: outcomeOptions,
    scoringDimension: "STRATEGIC_ALIGNMENT",
    tags: ["tradeoff", "ranking"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 27,
    questionText: "If the company could only improve one thing in the next 90 days, what should it be?",
    responseType: "FREE_TEXT",
    scoringDimension: "URGENCY",
    tags: ["90-days", "focus"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 28,
    questionText: "If the company could only fund one AI pilot, which area should receive it and why?",
    responseType: "FREE_TEXT",
    scoringDimension: "BUSINESS_IMPACT",
    tags: ["pilot", "funding"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 29,
    questionText: "Choose the statement that best describes what the company needs next.",
    responseType: "FORCED_CHOICE",
    options: [
      "We need quick wins now",
      "We need foundational cleanup first",
      "We need leadership alignment first",
      "We need better data first",
      "We need a high-impact pilot to create momentum",
    ],
    scoringDimension: "STRATEGIC_ALIGNMENT",
    tags: ["sequencing", "readiness-fit"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 30,
    questionText: "Which department or function would be most affected by your recommended first pilot?",
    responseType: "DEPARTMENT",
    options: [
      "Sales",
      "Marketing",
      "Customer Success",
      "Operations",
      "RevOps",
      "IT",
      "Finance",
      "HR / People",
      "Product",
      "Executive Leadership",
      "Cross-functional",
    ],
    scoringDimension: "RESPONDENT_ALIGNMENT",
    tags: ["department"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 31,
    questionText: "How confident are you that your recommended priority is the right first move?",
    responseType: "CONFIDENCE",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Low confidence", "5": "High confidence" },
    scoringDimension: "CONFIDENCE",
    tags: ["confidence"],
  }),
  q({
    section: "Priority Tradeoffs",
    order: 32,
    questionText: "How urgent is it to act on this priority?",
    responseType: "URGENCY",
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { "1": "Not urgent", "5": "Very urgent" },
    scoringDimension: "URGENCY",
    tags: ["urgency"],
  }),
];

export function normalizePriorityQuestion(input: unknown) {
  return PriorityQuestionInputSchema.parse(input);
}

export function parsePriorityJsonImport(raw: string) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON import must be an array of question objects.");
  }
  return parsed.map(normalizePriorityQuestion);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function boolFromCsv(value: string, fallback: boolean) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["true", "1", "yes", "y"].includes(normalized);
}

function numberFromCsv(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function listFromCsv(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {}
  return trimmed
    .split(/[|;]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parsePriorityCsvImport(raw: string) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must include a header row and at least one data row.");

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const expected = [...PRIORITY_CSV_COLUMNS];
  const mismatch =
    headers.length !== expected.length ||
    headers.some((header, index) => header !== expected[index]);
  if (mismatch) {
    throw new Error(`CSV headers must exactly match: ${expected.join(", ")}`);
  }

  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
    const normalized = normalizePriorityQuestion({
      section: row.section,
      questionText: row.questionText,
      questionHelpText: row.questionHelpText || null,
      responseType: row.responseType,
      options: listFromCsv(row.options),
      scaleMin: numberFromCsv(row.scaleMin),
      scaleMax: numberFromCsv(row.scaleMax),
      required: boolFromCsv(row.required, true),
      order: numberFromCsv(row.order) ?? index + 1,
      tags: listFromCsv(row.tags),
      scoringDimension: row.scoringDimension || null,
      isActive: boolFromCsv(row.isActive, true),
    });
    return normalized;
  });
}
