import type { Industry } from "@prisma/client";

export const INDUSTRY_OPTIONS: Array<{ value: Industry; label: string }> = [
  { value: "LOGISTICS_TRANSPORTATION", label: "Logistics & Transportation" },
  { value: "MANUFACTURING_INDUSTRIAL", label: "Manufacturing & Industrial" },
  { value: "TECHNOLOGY_SAAS", label: "Technology & SaaS" },
  { value: "HEALTHCARE_LIFE_SCIENCES", label: "Healthcare & Life Sciences" },
  { value: "FINANCIAL_SERVICES", label: "Financial Services" },
  { value: "RETAIL_ECOMMERCE", label: "Retail & E-commerce" },
  { value: "PROFESSIONAL_SERVICES", label: "Professional Services" },
  { value: "CONSTRUCTION_REAL_ESTATE", label: "Construction & Real Estate" },
  { value: "ENERGY_UTILITIES", label: "Energy & Utilities" },
  { value: "EDUCATION_TRAINING", label: "Education & Training" },
  { value: "HOSPITALITY_TRAVEL", label: "Hospitality & Travel" },
  { value: "NONPROFIT_PUBLIC_SECTOR", label: "Nonprofit & Public Sector" },
  { value: "MEDIA_ENTERTAINMENT", label: "Media & Entertainment" },
  { value: "AGRICULTURE_FOOD_PRODUCTION", label: "Agriculture & Food Production" },
  { value: "OTHER_HYBRID", label: "Other / Hybrid" },
];

const INDUSTRY_BY_NORMALIZED = new Map<string, Industry>(
  INDUSTRY_OPTIONS.flatMap((i) => {
    const label = i.label.toLowerCase();
    return [
      [label, i.value],
      [label.replaceAll("&", "and"), i.value],
      [label.replaceAll("&", "and").replaceAll("/", " "), i.value],
      [label.replaceAll("&", " ").replaceAll("/", " "), i.value],
      [label.replaceAll(" ", "_"), i.value],
    ];
  })
);

export function normalizeIndustryText(raw: string | null | undefined): Industry | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const upper = s.toUpperCase() as Industry;
  if (upper === "ALL_INDUSTRIES") return upper;
  if (INDUSTRY_OPTIONS.some((x) => x.value === upper)) return upper;
  const normalized = s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .trim();
  return INDUSTRY_BY_NORMALIZED.get(normalized) ?? null;
}

export function industryLabel(value: Industry | null | undefined): string | null {
  if (!value) return null;
  if (value === "ALL_INDUSTRIES") return "All industries";
  return INDUSTRY_OPTIONS.find((x) => x.value === value)?.label ?? value;
}

