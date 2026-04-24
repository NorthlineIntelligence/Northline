import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { createReadStream, existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { anonymizeOrgText } from "@/lib/anonymizeOrgText";

const ParamsSchema = z.object({ id: z.string().uuid() });
const DALL_E_PROMPT_MAX = 3900;
const REFERENCE_IMAGE_PATH =
  "/Users/joshadecker/.cursor/projects/Users-joshadecker-Projects-nl-readiness-assessment/assets/ChatGPT_Image_Apr_24__2026__11_46_41_AM-62a4636c-ad80-4e6b-8017-64a91b800068.png";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing.");
  return new OpenAI({ apiKey: key });
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const parsed = ParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      name: true,
      industry: true,
      workflow_map_ai_summary: true,
    },
  });
  if (!org) return NextResponse.json({ ok: false, error: "Organization not found" }, { status: 404 });

  const summary = anonymizeOrgText({
    text: org.workflow_map_ai_summary,
    organizationName: org.name,
    industry: org.industry,
  })?.trim();
  if (!summary) {
    return NextResponse.json(
      { ok: false, error: "Generate a workflow map first, then generate the infographic." },
      { status: 400 }
    );
  }

  const basePrompt = [
    "You are an enterprise systems strategist and visual designer.",
    "",
    "Your task is to create a clean, executive-level infographic titled:",
    "EXECUTIVE WORKFLOW SYSTEM MAP",
    "",
    "This must be visually structured for a boardroom / VP-level audience.",
    "No typos. No hallucinated words. No filler text. Everything must be precise and readable.",
    "",
    "OBJECTIVE:",
    "Design a workflow system map that clearly shows:",
    "- How work flows today",
    "- Where work breaks",
    "- Where data is fragmented",
    "- Where delays and inefficiencies occur",
    "- What the ideal future state looks like",
    "",
    "LAYOUT STRUCTURE (MANDATORY)",
    "",
    "1) HEADER",
    "- Title: EXECUTIVE WORKFLOW SYSTEM MAP",
    "- Subtitle: Current State: brief one-line summary",
    "",
    "2) TOP ROW: 3 HORIZONTAL SWIMLANES",
    "- SALES / MARKETING",
    "- OPERATIONS / ONBOARDING",
    "- SUPPORT / RETENTION",
    "",
    "Each lane must show:",
    "A) SYSTEM FLOW (top row inside each lane)",
    "- Use boxes with system names (Mailchimp, Google Ads, HubSpot, Salesforce, Monday.com, Zendesk, etc.)",
    "- Connect with arrows",
    "- Keep spacing clean and aligned",
    "",
    "B) HANDOFF FLOW (middle row)",
    "- Show where transitions happen",
    "- Label clearly:",
    "  - Manual Handoff",
    "  - Manual Process",
    "  - Delay (1-3 days)",
    "- Use red warning indicators",
    "",
    "C) DATA FLOW (bottom row)",
    "- Show where data is stored or broken",
    "- Label clearly:",
    "  - Siloed Data",
    "  - No Feedback Loop",
    "  - Limited Visibility",
    "",
    "3) RIGHT SIDEBAR",
    "ROADBLOCKS & BOTTLENECKS (clean bullets):",
    "- Data Fragmentation - systems do not share data reliably",
    "- Manual Handoffs - emails and manual pushes create delays",
    "- Pipeline Blind Spots - older leads ignored",
    "- Onboarding Delays - 24-72 hour lag",
    "- Support Isolation - no connection to revenue or retention",
    "- Inconsistent Integrations - unreliable automation",
    "",
    "FUTURE STATE (IDEAL FLOW):",
    "- Unified Lead Capture",
    "- Integrated CRM (HubSpot + Salesforce)",
    "- Automated Onboarding (trigger-based)",
    "- Connected Support (Zendesk + CRM)",
    "- Unified Analytics Dashboard",
    "- End statement: Single Source of Truth -> End-to-End Customer Journey",
    "",
    "4) MIDDLE SECTION",
    "SYSTEM FAILURES & BUSINESS IMPACT (icon-style categories):",
    "- Data Fragmentation -> No single source of truth",
    "- Manual Work -> Time waste + errors",
    "- Limited Visibility -> Poor decision-making",
    "- Revenue Impact -> Missed conversion + retention",
    "- Scaling Issues -> Cannot grow efficiently",
    "",
    "5) BOTTOM ROW",
    "FIRST 30-DAY ACTIONS (6 items max):",
    "- Stakeholder alignment",
    "- Integration audit",
    "- Lead flow automation",
    "- SLA definition",
    "- Visibility dashboards",
    "- Feedback loops",
    "",
    "NORTHLINE ENTRY POINTS:",
    "- Integrated Data Layer",
    "- Journey Mapping",
    "- SLA Definition",
    "- Change Management",
    "- AI Readiness Foundation",
    "",
    "6) LEGEND",
    "- Arrow: Automated Flow",
    "- Warning icon: Manual Step",
    "- Clock icon: Delay",
    "- Puzzle icon: Data Issue",
    "",
    "7) DESIGN RULES (CRITICAL)",
    "- Clean, modern, corporate style",
    "- No clutter",
    "- No overlapping elements",
    "- Consistent icon usage",
    "- Consistent spacing",
    "- Font must be readable and professional",
    "- Use structured alignment (grid-based)",
    "",
    "8) COLOR PALETTE (USE EXACTLY)",
    "- Navy Blue: #0B1D3A (headers)",
    "- Teal: #0F766E (operations)",
    "- Purple: #5B2C83 (support)",
    "- Green: #047857 (success/future)",
    "- Red: #DC2626 (issues)",
    "- Gray: #64748B (neutral text)",
    "",
    "9) OUTPUT REQUIREMENTS",
    "- No spelling errors",
    "- No fake words",
    "- No distorted text",
    "- No overlapping UI elements",
    "- Must look like a consulting-grade slide (McKinsey / Deloitte level)",
    "",
    "10) INPUT DATA",
    "Use the workflow details below to generate the infographic.",
    "Do not include legal company names; refer only to 'the company'.",
    "",
    "WORKFLOW DETAILS:",
    summary,
  ].join("\n");

  const client = getClient();
  const blueprintResponse = await client.responses.create({
    model: "gpt-4.1",
    input: [
      {
        role: "system",
        content:
          "You create deterministic visual blueprints for infographics. Output only concise, production-ready spec text with no markdown fences.",
      },
      {
        role: "user",
        content:
          "Transform the prompt into an image rendering blueprint for a multimodal image model. " +
          "Preserve all constraints, section labels, and palette. " +
          "Return only: (1) final canvas layout spec, (2) exact on-image copy snippets, (3) typography hierarchy, (4) spacing and alignment rules, (5) icon usage rules. " +
          "No extra commentary.\n\n" +
          basePrompt,
      },
    ],
  });
  const blueprint = (blueprintResponse.output_text ?? "").trim();
  const imagePrompt = [
    "Render a single polished business infographic exactly from this blueprint.",
    "Use a clean slide aesthetic suitable for C-suite presentation.",
    "Do not add gibberish text. Keep all text crisp and correctly spelled.",
    "",
    "BLUEPRINT START",
    blueprint || basePrompt,
    "BLUEPRINT END",
  ].join("\n");
  const compressedPrompt =
    imagePrompt.length > DALL_E_PROMPT_MAX
      ? `${imagePrompt.slice(0, DALL_E_PROMPT_MAX - 120)}\n\n[Truncated to fit DALL-E prompt limits. Keep all required structure and styling.]`
      : imagePrompt;

  // Primary path: reference-guided generation with gpt-image-1
  try {
    if (existsSync(REFERENCE_IMAGE_PATH)) {
      const edited = await client.images.edit({
        model: "gpt-image-1",
        image: createReadStream(REFERENCE_IMAGE_PATH),
        prompt:
          `${compressedPrompt}\n\n` +
          "Use the provided reference image as a strict layout/style guide. " +
          "Preserve its section architecture, spacing discipline, executive visual hierarchy, and card/grid composition. " +
          "Replace content with the provided workflow details while keeping this same premium map format.",
        size: "1536x1024",
      });
      const editedB64 = edited.data?.[0]?.b64_json;
      if (editedB64) {
        return NextResponse.json({
          ok: true,
          infographic_data_url: `data:image/png;base64,${editedB64}`,
          model_used: "gpt-image-1-edit",
        });
      }
    }
  } catch {
    // continue to secondary generators
  }

  try {
    const primary = await client.images.generate({
      model: "gpt-image-1",
      prompt:
        `${compressedPrompt}\n\n` +
        "Target exact consulting-slide quality with legible text and strict grid alignment. " +
        "No gibberish text. No overlaps.",
      size: "1536x1024",
    });
    const primaryB64 = primary.data?.[0]?.b64_json;
    if (primaryB64) {
      return NextResponse.json({
        ok: true,
        infographic_data_url: `data:image/png;base64,${primaryB64}`,
        model_used: "gpt-image-1",
      });
    }
  } catch {
    // continue to fallback
  }

  let image: OpenAI.Images.ImagesResponse;
  try {
    image = await client.images.generate({
      model: "dall-e-3",
      size: "1792x1024",
      quality: "hd",
      prompt: compressedPrompt,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Image generation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const imageUrl = image.data?.[0]?.url;
  if (!imageUrl) {
    return NextResponse.json({ ok: false, error: "Image generation returned no URL output." }, { status: 502 });
  }

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    return NextResponse.json({ ok: false, error: "Could not download generated image output." }, { status: 502 });
  }
  const ab = await imageRes.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");

  return NextResponse.json({
    ok: true,
    infographic_data_url: `data:image/png;base64,${b64}`,
    model_used: "dall-e-3",
  });
}
