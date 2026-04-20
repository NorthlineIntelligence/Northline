import PDFDocument from "pdfkit";

function val(v: unknown, fallback = "—") {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function asLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
}

export async function renderAssessmentNarrativePdfBuffer(args: {
  organizationName: string;
  assessmentName: string | null;
  assessmentCreatedAt: Date;
  assessmentId: string;
  readinessScore: number | null;
  readinessBand: string | null;
  narrativeJson: unknown;
}): Promise<Buffer> {
  const n =
    args.narrativeJson && typeof args.narrativeJson === "object"
      ? (args.narrativeJson as Record<string, unknown>)
      : {};

  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(18).text("Executive Insights Archive");
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Organization: ${args.organizationName}`);
  doc.text(`Assessment: ${args.assessmentName ?? "Untitled assessment"}`);
  doc.text(`Assessment date: ${args.assessmentCreatedAt.toLocaleString()}`);
  doc.text(`Assessment ID: ${args.assessmentId}`);
  doc.text(
    `Readiness: ${
      args.readinessScore == null ? "—" : args.readinessScore.toFixed(2)
    }${args.readinessBand ? ` (${args.readinessBand})` : ""}`
  );
  doc.moveDown(1);

  doc.fontSize(13).text("Executive Memo");
  doc.moveDown(0.3);
  const bullets = asLines(n.executiveSummaryBullets);
  if (!bullets.length) {
    doc.fontSize(10).text("No executive summary bullets available.");
  } else {
    doc.fontSize(10);
    bullets.forEach((b) => doc.text(`• ${b}`));
  }

  doc.moveDown(0.8);
  doc.fontSize(13).text("Current State");
  doc.moveDown(0.2);
  const currentState =
    n.currentState && typeof n.currentState === "object"
      ? (n.currentState as Record<string, unknown>)
      : {};
  doc.fontSize(10).text("Strengths:");
  asLines(currentState.strengths).forEach((s) => doc.text(`• ${s}`));
  doc.moveDown(0.2);
  doc.text("Gaps:");
  asLines(currentState.gaps).forEach((s) => doc.text(`• ${s}`));
  doc.moveDown(0.2);
  doc.text("Blockers:");
  asLines(currentState.blockers).forEach((s) => doc.text(`• ${s}`));

  doc.moveDown(0.8);
  doc.fontSize(13).text("Risks");
  doc.moveDown(0.2);
  const risks = n.risks && typeof n.risks === "object" ? (n.risks as Record<string, unknown>) : {};
  doc.fontSize(10).text(val(risks.implications, "No risk implications available."));

  const pr =
    risks.pillarRiskInterpretation && typeof risks.pillarRiskInterpretation === "object"
      ? (risks.pillarRiskInterpretation as Record<string, unknown>)
      : {};
  doc.moveDown(0.4);
  doc.text(`System Integrity: ${val(pr.systemIntegrity)}`);
  doc.moveDown(0.2);
  doc.text(`Human Alignment: ${val(pr.humanAlignment)}`);
  doc.moveDown(0.2);
  doc.text(`Strategic Coherence: ${val(pr.strategicCoherence)}`);
  doc.moveDown(0.2);
  doc.text(`Sustainability Practice: ${val(pr.sustainabilityPractice)}`);

  doc.end();
  return done;
}

