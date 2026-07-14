/**
 * Assessment Executive Insights narrative prompts (reference for workbench).
 * Live generation: POST /api/assessments/[id]/narrative/generate (Anthropic when NARRATIVE_AI_ENABLED).
 */

export const NARRATIVE_ASSESSMENT_MODEL_NOTE =
  "Assessment completion narratives use Anthropic (NARRATIVE_AI_MODEL). Workbench analysis uses the private model router (Fast / Executive).";

export const NARRATIVE_EXECUTIVE_SUMMARY_SYSTEM_EXCERPT = `SECTION REQUIREMENTS — Executive Summary & Memo:
1. Executive Memo (maturityInterpretation.explanation)
- Target up to 1500 words, workshop-ready.
- Structure with headings: Executive Narrative, Key dynamics, Strategic implications, Executive takeaway.
- executiveSummaryBullets: up to 6 bullets summarizing the readout.

PERCEPTION & ALIGNMENT:
- When perceptionAlignmentSignals is non-empty, add perceptionAlignmentExecutiveNote verbatim as one executiveSummaryBullets item.`;

export const NARRATIVE_RISK_SYSTEM_EXCERPT = `SECTION REQUIREMENTS — Risk (risks object):
9. risks
- Use provided risk flags when present.
- implications: substantive paragraph (at least 4 sentences), shown as "In brief".
- pillarRiskInterpretation REQUIRED: systemIntegrity, humanAlignment, strategicCoherence, sustainabilityPractice.
- Each pillar: 3+ sentences tied to pillar scores; executive actions; no placeholders (TBD).`;

export const NARRATIVE_USER_PROMPT_TEMPLATE = `Generate a workshop-ready executive AI readout that matches the required JSON shape.

Important requirements:
- Do not use a real company name, brand, or domain.
- Use only the provided organization.reference value or 'the company'.
- Use the free-text evidence in the analysis.
- Keep every recommendation practical and grounded in the assessment data.
- Return ONLY valid JSON.

INPUT: <assessment results, evidence, pillar scores, riskFlags, documents>`;

export const PERCEPTION_ALIGNMENT_EXECUTIVE_NOTE =
  "While overall readiness scores are strong, response patterns show a high level of consistency across areas that often vary in operational environments. This may indicate an opportunity to validate how processes function in practice across teams. Before expanding AI initiatives, aligning on how work is executed day-to-day can help ensure that automation reinforces consistency rather than amplifying hidden variability.";
