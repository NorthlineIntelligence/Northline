import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function splitLegacyContextNotes(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { context: "", tech: "", integrations: "" };

  const markerRegex = /Known Tech Stack & Integrations:\s*/i;
  const idx = raw.search(markerRegex);
  if (idx < 0) return { context: raw.trim(), tech: "", integrations: "" };

  const context = raw.slice(0, idx).trim();
  const payload = raw.slice(idx).replace(markerRegex, "").trim();
  if (!payload) return { context, tech: "", integrations: "" };

  const lines = payload
    .split(/\n|,|;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
  const integrationHints = /(zapier|make\.com|n8n|webhook|api|integration|connector|etl|sync)/i;
  const tech = [];
  const integrations = [];
  for (const line of lines) {
    if (integrationHints.test(line)) integrations.push(line);
    else tech.push(line);
  }
  return {
    context,
    tech: Array.from(new Set(tech)).join("\n"),
    integrations: Array.from(new Set(integrations)).join("\n"),
  };
}

async function run() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      context_notes: true,
      tech_stack_notes: true,
      integration_notes: true,
    },
  });

  let updated = 0;
  for (const org of orgs) {
    if (org.tech_stack_notes || org.integration_notes) continue;
    const split = splitLegacyContextNotes(org.context_notes);
    if (!split.tech && !split.integrations) continue;
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        context_notes: split.context || null,
        tech_stack_notes: split.tech || null,
        integration_notes: split.integrations || null,
      },
    });
    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} organization record(s).`);
}

run()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
