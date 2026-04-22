import type { Industry, QuestionContextMode } from "@prisma/client";

const INDUSTRY_CONTEXT_KEYS: Record<Industry, string[]> = {
  ALL_INDUSTRIES: ["ALL", "ALL_INDUSTRIES", "DEFAULT", "GENERAL"],
  LOGISTICS_TRANSPORTATION: ["LOGISTICS_TRANSPORTATION", "LOGISTICS", "TRANSPORTATION"],
  MANUFACTURING_INDUSTRIAL: ["MANUFACTURING_INDUSTRIAL", "MANUFACTURING", "INDUSTRIAL"],
  TECHNOLOGY_SAAS: ["TECHNOLOGY_SAAS", "TECHNOLOGY", "SAAS"],
  HEALTHCARE_LIFE_SCIENCES: ["HEALTHCARE_LIFE_SCIENCES", "HEALTHCARE", "LIFE_SCIENCES"],
  FINANCIAL_SERVICES: ["FINANCIAL_SERVICES", "FINANCIAL"],
  RETAIL_ECOMMERCE: ["RETAIL_ECOMMERCE", "RETAIL", "ECOMMERCE"],
  PROFESSIONAL_SERVICES: ["PROFESSIONAL_SERVICES", "PROFESSIONAL"],
  CONSTRUCTION_REAL_ESTATE: ["CONSTRUCTION_REAL_ESTATE", "CONSTRUCTION", "REAL_ESTATE"],
  ENERGY_UTILITIES: ["ENERGY_UTILITIES", "ENERGY", "UTILITIES"],
  EDUCATION_TRAINING: ["EDUCATION_TRAINING", "EDUCATION", "TRAINING"],
  HOSPITALITY_TRAVEL: ["HOSPITALITY_TRAVEL", "HOSPITALITY", "TRAVEL"],
  NONPROFIT_PUBLIC_SECTOR: ["NONPROFIT_PUBLIC_SECTOR", "NONPROFIT", "PUBLIC_SECTOR"],
  MEDIA_ENTERTAINMENT: ["MEDIA_ENTERTAINMENT", "MEDIA", "ENTERTAINMENT"],
  AGRICULTURE_FOOD_PRODUCTION: ["AGRICULTURE_FOOD_PRODUCTION", "AGRICULTURE", "FOOD_PRODUCTION"],
  OTHER_HYBRID: ["OTHER_HYBRID", "OTHER", "HYBRID"],
};

type IndustryContextMap = Record<string, string>;

function normalizeContextMap(raw: unknown): IndustryContextMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: IndustryContextMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const key = k.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const value = v.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function pickIndustryContext(map: IndustryContextMap, industry: Industry): string | null {
  const keys = INDUSTRY_CONTEXT_KEYS[industry] ?? [];
  for (const key of keys) {
    const hit = map[key];
    if (typeof hit === "string" && hit.trim()) return hit.trim();
  }
  return null;
}

function ensureSentenceSpacing(left: string, right: string) {
  const l = left.trim();
  const r = right.trim();
  if (!l) return r;
  if (!r) return l;
  if (/[.!?]$/.test(l)) return `${l} ${r}`;
  return `${l} ${r}`;
}

function renderInline(core: string, context: string) {
  const coreTrimmed = core.trim();
  const contextTrimmed = context.trim();
  const phraseMatch = coreTrimmed.match(/(systems?|workflows?|process(es)?|operations?)/i);
  if (!phraseMatch?.index && phraseMatch?.index !== 0) {
    return `${coreTrimmed} (${contextTrimmed})`;
  }
  const start = phraseMatch.index;
  const end = start + phraseMatch[0].length;
  return `${coreTrimmed.slice(0, end)} (${contextTrimmed})${coreTrimmed.slice(end)}`;
}

export function renderQuestionText(args: {
  questionCore: string;
  contextMode: QuestionContextMode;
  selectedIndustry: Industry;
  industryContextJson: unknown;
}) {
  const core = args.questionCore.trim();
  if (!core) return "";
  if (args.contextMode === "NONE") return core;

  const map = normalizeContextMap(args.industryContextJson);
  const industryContext = pickIndustryContext(map, args.selectedIndustry);
  if (!industryContext) return core;

  if (args.contextMode === "APPEND") {
    return ensureSentenceSpacing(core, industryContext);
  }

  return renderInline(core, industryContext);
}

