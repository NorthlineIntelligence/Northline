"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";
import { ConsultantNotesPanel } from "@/components/priority-discovery/ConsultantNotesPanel";
import { ClientSpecificInternalReadoutView } from "@/components/priority-discovery/ClientSpecificInternalReadoutView";
import type { ClientSpecificInternalReadout } from "@/lib/priorityDiscovery/clientSpecificReadout";
import type { ReadoutProfileSlug } from "@/lib/priorityDiscovery/analysisPersistence";

type Project = {
  id: string;
  rank: number;
  projectName: string;
  problemStatement: string;
  recommendedSolution: string;
  shortTermImpact: string;
  longTermImpact: string;
  implementationRisk: string;
  readinessDependency: string;
  firstStep: string;
  estimatedEffort: string | null;
  estimatedTimeHorizon: string | null;
  aiSuitabilityScore: number;
  automationSuitabilityScore: number;
  businessImpactScore: number;
  urgencyScore: number;
  synergyScore: number;
  riskScore: number;
  priorityScore: number;
  confidenceLevel: string | null;
  evidenceJson: string[] | null;
};

type Analysis = {
  id: string;
  executiveSummary: string;
  overallSynergyScore: number;
  consultantNotesHtml: string | null;
  outputJson: {
    readoutProfile?: "standard" | "client_specific";
    executiveReadout?: ExecutiveReadout;
    impactAssessment?: ImpactAssessment;
    aiRecommendations?: AiRecommendation[];
    topPainPoints?: PainPoint[];
    shortTermOpportunities?: string[];
    longTermOpportunities?: string[];
    risksAndDependencies?: string[];
    riskRegister?: RiskItem[];
    managerReviewChecklist?: string[];
    formatVersion?: number;
    internalReadout?: ClientSpecificInternalReadout;
  };
  createdAt: string;
  projects: Project[];
};

type ExecutiveReadout = {
  headline?: string;
  executiveNarrative?: string;
  coreProblem?: string;
  strategicImplication?: string;
  decisionPoint?: string;
};

type ImpactAssessment = {
  valueCreation?: string;
  shortTermImpact?: string;
  longTermImpact?: string;
  costOfInaction?: string;
};

type AiRecommendation = {
  title: string;
  recommendation: string;
  executiveRationale: string;
  expectedImpact: string;
  requiredGuardrail: string;
  confidenceLevel: string;
};

type RiskItem = {
  risk: string;
  impact: string;
  severity: string;
  mitigation: string;
};

type PainPoint = {
  painPoint: string;
  impactScore?: number;
  urgencyScore?: number;
  mentionedByCount?: number;
};

function fitLabel(project: Project) {
  const risk = project.riskScore ?? 50;
  const priority = project.priorityScore ?? 0;
  const readinessText = (project.readinessDependency ?? "").toLowerCase();
  if (readinessText.includes("not recommended")) return "Not Recommended Yet";
  if (risk >= 70) return "Requires Foundation Work";
  if (priority >= 78 && risk <= 45) return "Ready Now";
  return "Pilot With Guardrails";
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function analysisQuery(readoutProfile: ReadoutProfileSlug) {
  return readoutProfile === "client_specific" ? "?profile=client_specific" : "";
}

export function PriorityReadoutAdminView({
  readoutProfile,
}: {
  readoutProfile: ReadoutProfileSlug;
}) {
  const isClientSpecific = readoutProfile === "client_specific";
  const params = useParams<{ id: string }>();
  const assessmentId = typeof params?.id === "string" ? params.id : "";
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [editedProjects, setEditedProjects] = useState<Record<string, Partial<Project>>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});

  const projects = useMemo(() => {
    return (analysis?.projects ?? []).map((project) => ({ ...project, ...(editedProjects[project.id] ?? {}) }));
  }, [analysis?.projects, editedProjects]);

  async function load() {
    setLoading(true);
    setMessage(null);
    const res = await fetch(
      `/api/admin/priority-discovery/assessments/${assessmentId}/analysis${analysisQuery(readoutProfile)}`,
      { credentials: "include" }
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error ?? `Failed to load analysis (${res.status}).`);
      setLoading(false);
      return;
    }
    setAnalysis(json.analysis);
    setLoading(false);
  }

  async function runAnalysis(forceRegenerate = false) {
    setRunning(true);
    setMessage(
      isClientSpecific
        ? "Generating client-specific internal readout from uploaded documents, CRM notes, and participant answers. This can take several minutes..."
        : "Generating executive readout. This can take several minutes with the executive model..."
    );
    try {
      const params = new URLSearchParams();
      if (analysis || forceRegenerate) params.set("force", "1");
      if (isClientSpecific) params.set("profile", "client_specific");
      const query = params.toString();
      const res = await fetch(
        `/api/admin/priority-discovery/assessments/${assessmentId}/analysis${query ? `?${query}` : ""}`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMessage(json?.error ?? `Analysis failed (${res.status}).`);
        setRunning(false);
        return;
      }
      setAnalysis(json.analysis);
      setEditedProjects({});
      setRunning(false);
      setMessage(
        isClientSpecific
          ? `Client-specific internal readout complete using ${json.modelUsed}.`
          : `Analysis complete using ${json.modelUsed}.`
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessage(
        `The request was interrupted before the browser received a response. Refresh this page to check whether the readout was saved. Detail: ${detail}`
      );
      setRunning(false);
    }
  }

  useEffect(() => {
    if (assessmentId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId, readoutProfile]);

  function exportJson() {
    if (!analysis) return;
    download(
      "priority-discovery-analysis.json",
      JSON.stringify(
        {
          ...analysis.outputJson,
          consultantNotesHtml: analysis.consultantNotesHtml,
          topPriorityProjects: projects,
        },
        null,
        2
      ),
      "application/json"
    );
  }

  function exportTop5Csv() {
    const rows = [
      "rank,projectName,priorityScore,synergyScore,aiSuitabilityScore,automationSuitabilityScore,riskScore,firstStep",
      ...projects.map((p) =>
        [p.rank, p.projectName, p.priorityScore, p.synergyScore, p.aiSuitabilityScore, p.automationSuitabilityScore, p.riskScore, p.firstStep]
          .map(csvEscape)
          .join(",")
      ),
    ];
    download("top-5-priority-projects.csv", rows.join("\n") + "\n", "text/csv");
  }

  function exportOnePage() {
    const consultantNotes = analysis?.consultantNotesHtml
      ? `\nConsultant Notes:\n${stripHtml(analysis.consultantNotesHtml)}\n`
      : "";
    const content = [
      "AI Priority Discovery Assessment: Top 5 Priority Projects",
      "",
      analysis?.executiveSummary ?? "",
      consultantNotes,
      "",
      ...projects.map((p) => `${p.rank}. ${p.projectName}\nPriority: ${p.priorityScore} | Synergy: ${p.synergyScore} | Risk: ${p.implementationRisk}\nFirst step: ${p.firstStep}\n`),
    ].join("\n");
    download("top-5-priority-projects-summary.txt", content, "text/plain");
  }

  async function exportResponsesCsv() {
    const res = await fetch(`/api/admin/priority-discovery/assessments/${assessmentId}/analysis?format=responses_csv`, {
      credentials: "include",
    });
    const text = await res.text();
    if (!res.ok) {
      setMessage(text || "Response export failed.");
      return;
    }
    download("priority-discovery-responses.csv", text, "text/csv");
  }

  const output = analysis?.outputJson ?? {};
  const internalReadout = isClientSpecific ? output.internalReadout ?? null : null;
  const executiveReadout = output.executiveReadout;
  const impactAssessment = output.impactAssessment;
  const aiRecommendations = output.aiRecommendations ?? [];
  const heatmap = output.topPainPoints ?? [];
  const shortTerm = output.shortTermOpportunities ?? [];
  const longTerm = output.longTermOpportunities ?? [];
  const risks = output.risksAndDependencies ?? [];
  const riskRegister = output.riskRegister ?? [];
  const managerReviewChecklist = output.managerReviewChecklist ?? [];

  return (
    <div className="min-h-screen" style={{ background: shellBackground, color: BRAND.dark }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div
          className="mb-5 rounded-xl border px-4 py-3 text-xs leading-5"
          style={{
            borderColor: isClientSpecific ? BRAND.cyan : BRAND.border,
            background: isClientSpecific ? "#E8F7F8" : "#F9FAFB",
            color: BRAND.greyBlue,
          }}
        >
          {isClientSpecific ? (
            <>
              <span className="font-semibold" style={{ color: BRAND.dark }}>
                Admin-only internal readout.
              </span>{" "}
              This version is grounded in uploaded documents, CRM notes, and participant answers. It does not replace the
              standard executive readout that participants see in Executive Insights.
            </>
          ) : (
            <>
              <span className="font-semibold" style={{ color: BRAND.dark }}>
                Private AI processing.
              </span>{" "}
              This readout is generated using Northline&apos;s private language model on a secure, dedicated server.
              Client assessment data is not sent to public or open LLM services.
            </>
          )}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em]" style={{ color: BRAND.cyan }}>
              {isClientSpecific ? "Admin delivery planning" : "Decision-support recommendations"}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {isClientSpecific ? "Client-Specific Internal Readout" : "AI Priority Discovery Results"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-medium" style={{ color: BRAND.greyBlue }}>
              {isClientSpecific
                ? "A deeper, client-tailored readout for Northline admins. Use this for delivery planning, PM roadmaps, and internal strategy work."
                : "Executive-ready Top 5 AI and automation opportunities tied to participant evidence. Human review is expected before export or implementation."}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <Link href="/admin/assessments" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm" style={{ borderColor: BRAND.border }}>Assessments</Link>
            {isClientSpecific ? (
              <Link
                href={`/admin/assessments/${assessmentId}/priority-results`}
                className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm"
                style={{ borderColor: BRAND.border }}
              >
                Customer readout →
              </Link>
            ) : (
              <Link
                href={`/admin/assessments/${assessmentId}/priority-client-readout`}
                className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm"
                style={{ borderColor: BRAND.border }}
              >
                Internal client readout →
              </Link>
            )}
            <button
              onClick={() => runAnalysis(Boolean(analysis))}
              disabled={running}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm"
              style={{ background: running ? "#98a2b3" : isClientSpecific ? BRAND.cyan : BRAND.dark }}
            >
              {running
                ? "Generating..."
                : analysis
                  ? isClientSpecific
                    ? "Regenerate Client-Specific Readout"
                    : "Regenerate Executive Readout"
                  : isClientSpecific
                    ? "Generate Client-Specific Readout"
                    : "Generate Executive Readout"}
            </button>
          </div>
        </div>

        {message ? <div className="mt-5 rounded-xl border bg-white p-4 text-sm font-semibold" style={{ borderColor: BRAND.border }}>{message}</div> : null}

        {loading ? (
          <div className="mt-8 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>Loading...</div>
        ) : !analysis ? (
          <div className="mt-8 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-lg font-semibold">No analysis yet</div>
            <p className="mt-2 text-sm" style={{ color: BRAND.greyBlue }}>
              {isClientSpecific
                ? "Generate the client-specific internal readout after participants have submitted responses."
                : "Run the AI analysis after participants have submitted responses."}
            </p>
          </div>
        ) : (
          <>
            {isClientSpecific && internalReadout ? (
              <ClientSpecificInternalReadoutView
                assessmentId={assessmentId}
                analysisId={analysis.id}
                consultantNotesHtml={analysis.consultantNotesHtml}
                internalReadout={internalReadout}
                createdAt={analysis.createdAt}
                onNotesSaved={(html) => setAnalysis((prev) => (prev ? { ...prev, consultantNotesHtml: html } : prev))}
              />
            ) : isClientSpecific ? (
              <div className="mt-8 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
                <div className="text-lg font-semibold">Legacy client readout format detected</div>
                <p className="mt-2 text-sm" style={{ color: BRAND.greyBlue }}>
                  Regenerate to produce the new detailed internal diagnostic readout.
                </p>
              </div>
            ) : (
              <>
            <div className="no-print mt-6 flex flex-wrap gap-2">
              <button onClick={exportJson} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Export JSON</button>
              <button onClick={exportResponsesCsv} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Export Responses CSV</button>
              <button onClick={exportTop5Csv} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Export Top 5 CSV</button>
              <button onClick={exportOnePage} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>One-page Summary</button>
              <button onClick={() => window.print()} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }}>Print / Save PDF</button>
            </div>

            <section className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_0.7fr]">
              <div className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
                <div className="text-xs font-black uppercase tracking-[0.14em]" style={{ color: BRAND.cyan }}>
                  {isClientSpecific ? "Client-specific readout" : "Executive readout"}
                </div>
                <h2 className="mt-2 text-2xl font-semibold leading-tight">
                  {executiveReadout?.headline ?? "Priority Discovery Executive Summary"}
                </h2>
                <div className="mt-4">
                  <FormattedNarrative text={analysis.executiveSummary} />
                </div>
                {executiveReadout?.executiveNarrative ? (
                  <div className="mt-5 rounded-2xl border p-5" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                    <div className="text-sm font-black uppercase tracking-[0.12em]" style={{ color: BRAND.greyBlue }}>
                      Executive Narrative
                    </div>
                    <div className="mt-3">
                      <FormattedNarrative text={executiveReadout.executiveNarrative} />
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 text-xs font-semibold" style={{ color: BRAND.greyBlue }}>
                  Generated {new Date(analysis.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border bg-white p-6 text-center shadow-sm" style={{ borderColor: BRAND.border }}>
                <div className="text-sm font-black uppercase tracking-[0.12em]" style={{ color: BRAND.greyBlue }}>Overall Synergy</div>
                <div className="mt-3 text-5xl font-black" style={{ color: BRAND.dark }}>{analysis.overallSynergyScore}</div>
                <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.greyBlue }}>
                  {analysis.overallSynergyScore >= 80 ? "Strong alignment" : analysis.overallSynergyScore >= 60 ? "Moderate alignment" : analysis.overallSynergyScore >= 40 ? "Fragmented alignment" : "Low alignment"}
                </div>
              </div>
            </section>

            <ConsultantNotesPanel
              analysisId={analysis.id}
              assessmentId={assessmentId}
              initialHtml={analysis.consultantNotesHtml}
              onSaved={(html) => setAnalysis((prev) => (prev ? { ...prev, consultantNotesHtml: html } : prev))}
            />

            <section className="mt-6 grid gap-5 lg:grid-cols-3">
              <ExecutiveSignal
                title="Core Problem"
                value={executiveReadout?.coreProblem ?? "Not available"}
                accent={BRAND.dark}
              />
              <ExecutiveSignal
                title="Strategic Implication"
                value={executiveReadout?.strategicImplication ?? "Not available"}
                accent={BRAND.cyan}
              />
              <ExecutiveSignal
                title="Decision Point"
                value={executiveReadout?.decisionPoint ?? analysis.outputJson?.managerReviewChecklist?.[0] ?? "Confirm the first pilot, owner, and success metric."}
                accent="#7C3AED"
              />
            </section>

            {impactAssessment ? (
              <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
                <h2 className="text-xl font-semibold">Problem, Solution, Impact</h2>
                <div className="mt-4 grid gap-4 lg:grid-cols-4">
                  <ImpactCard title="Value Creation" text={impactAssessment.valueCreation ?? ""} />
                  <ImpactCard title="Short-term Impact" text={impactAssessment.shortTermImpact ?? ""} />
                  <ImpactCard title="Long-term Impact" text={impactAssessment.longTermImpact ?? ""} />
                  <ImpactCard title="Cost of Inaction" text={impactAssessment.costOfInaction ?? ""} tone="risk" />
                </div>
              </section>
            ) : null}

            {aiRecommendations.length ? (
              <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold">Northline AI Recommendations</h2>
                  <div className="text-xs font-black uppercase tracking-[0.12em]" style={{ color: BRAND.greyBlue }}>
                    Decision support, not final decisions
                  </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {aiRecommendations.map((rec) => (
                    <div key={rec.title} className="rounded-2xl border p-5" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold">{rec.title}</h3>
                        <span className="rounded-full px-3 py-1 text-xs font-black uppercase" style={{ background: "#E8F7F8", color: BRAND.dark }}>
                          {rec.confidenceLevel}
                        </span>
                      </div>
                      <Info label="Recommendation" value={rec.recommendation} />
                      <Info label="Executive rationale" value={rec.executiveRationale} />
                      <Info label="Expected impact" value={rec.expectedImpact} />
                      <Info label="Required guardrail" value={rec.requiredGuardrail} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-6">
              <h2 className="text-xl font-semibold">Top 5 Priority Projects</h2>
              <div className="mt-4 grid gap-4">
                {projects.map((project) => (
                  <article key={project.id} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-black uppercase tracking-[0.12em]" style={{ color: BRAND.cyan }}>Rank {project.rank}</div>
                        <input
                          value={project.projectName}
                          onChange={(e) => setEditedProjects((prev) => ({ ...prev, [project.id]: { ...(prev[project.id] ?? {}), projectName: e.target.value } }))}
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-xl font-semibold"
                          style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                        <Score label="Priority" value={project.priorityScore} />
                        <Score label="Synergy" value={project.synergyScore} />
                        <Score label="AI Fit" value={project.aiSuitabilityScore} />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <TextEdit label="Problem" value={project.problemStatement} onChange={(v) => setEditedProjects((prev) => ({ ...prev, [project.id]: { ...(prev[project.id] ?? {}), problemStatement: v } }))} />
                      <TextEdit label="Recommended First Step" value={project.firstStep} onChange={(v) => setEditedProjects((prev) => ({ ...prev, [project.id]: { ...(prev[project.id] ?? {}), firstStep: v } }))} />
                      <Info label="Short-term impact" value={project.shortTermImpact} />
                      <Info label="Long-term impact" value={project.longTermImpact} />
                      <Info label="Risk level" value={`${project.implementationRisk} (${project.riskScore}/100)`} />
                      <Info label="Readiness dependency" value={project.readinessDependency} />
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-4">
                      <ScaleBar label="Business Impact" value={project.businessImpactScore} />
                      <ScaleBar label="Urgency" value={project.urgencyScore} />
                      <ScaleBar label="Automation Fit" value={project.automationSuitabilityScore} />
                      <ScaleBar label="Risk" value={project.riskScore} inverse />
                    </div>
                    <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: BRAND.border, background: "#f9fafb" }}>
                      <b>Priority vs Readiness Fit:</b> {fitLabel(project)}. {project.readinessDependency}
                    </div>
                    <button className="no-print mt-3 rounded-lg border bg-white px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border }} onClick={() => setOpenEvidence((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}>
                      {openEvidence[project.id] ? "Hide evidence" : "Show evidence"}
                    </button>
                    {openEvidence[project.id] ? (
                      <div className="mt-3 grid gap-2">
                        {(project.evidenceJson ?? []).map((evidence, index) => (
                          <blockquote key={index} className="rounded-lg border-l-4 bg-[#f9fafb] p-3 text-sm" style={{ borderColor: BRAND.cyan }}>
                            {evidence}
                          </blockquote>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-6 grid gap-5 lg:grid-cols-3">
              <Panel title="Pain Point Heatmap">
                {heatmap.map((p: PainPoint, index: number) => (
                  <div key={`${p.painPoint}-${index}`} className="mb-3 rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
                    <div className="font-semibold">{p.painPoint}</div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8eef8]">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(p.impactScore ?? 0, p.urgencyScore ?? 0)}%`, background: BRAND.cyan }} />
                    </div>
                    <div className="mt-2 text-xs" style={{ color: BRAND.greyBlue }}>Impact {p.impactScore} • Urgency {p.urgencyScore} • Mentioned by {p.mentionedByCount}</div>
                  </div>
                ))}
              </Panel>
              <Panel title="Opportunity Matrix">
                <div className="text-sm font-semibold">Short-term</div>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {shortTerm.map((item: string, index: number) => (
                    <li key={`short-term-${index}-${item}`}>{item}</li>
                  ))}
                </ul>
                <div className="mt-4 text-sm font-semibold">Long-term</div>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {longTerm.map((item: string, index: number) => (
                    <li key={`long-term-${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Risks and Dependencies">
                <ul className="list-disc pl-5 text-sm leading-6">
                  {risks.map((item: string, index: number) => (
                    <li key={`risk-dependency-${index}-${item}`}>{item}</li>
                  ))}
                </ul>
                <div className="mt-4 rounded-xl border p-3 text-sm font-semibold" style={{ borderColor: BRAND.border }}>
                  Recommended first pilot: {projects[0]?.projectName ?? "Not available"}
                </div>
              </Panel>
            </section>

            {riskRegister.length || managerReviewChecklist.length ? (
              <section className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <Panel title="Risk to Impact Register">
                  <div className="grid gap-3">
                    {riskRegister.map((risk) => (
                      <div key={risk.risk} className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold">{risk.risk}</div>
                          <span className="rounded-full px-3 py-1 text-xs font-black uppercase" style={{ background: severityColor(risk.severity).bg, color: severityColor(risk.severity).fg }}>
                            {risk.severity}
                          </span>
                        </div>
                        <div className="mt-2 text-sm leading-6"><b>Impact:</b> {risk.impact}</div>
                        <div className="mt-1 text-sm leading-6"><b>Mitigation:</b> {risk.mitigation}</div>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Manager Review Checklist">
                  <ul className="grid gap-2 text-sm">
                    {managerReviewChecklist.map((item, index) => (
                      <li key={`manager-review-${index}-${item}`} className="rounded-xl border p-3" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </section>
            ) : null}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Score(props: { label: string; value: number }) {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: BRAND.border, background: "#f9fafb" }}>
      <div style={{ color: BRAND.greyBlue }}>{props.label}</div>
      <div className="text-lg font-black" style={{ color: BRAND.dark }}>{props.value}</div>
    </div>
  );
}

function ScaleBar(props: { label: string; value: number; inverse?: boolean }) {
  const color = props.inverse
    ? props.value >= 70
      ? "#B42318"
      : props.value >= 45
        ? "#B54708"
        : BRAND.cyan
    : props.value >= 75
      ? BRAND.dark
      : props.value >= 55
        ? BRAND.cyan
        : "#B54708";

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: BRAND.border, background: "#FFFFFF" }}>
      <div className="flex justify-between gap-2 text-xs font-black uppercase tracking-[0.08em]" style={{ color: BRAND.greyBlue }}>
        <span>{props.label}</span>
        <span>{props.value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E8EEF8]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, props.value))}%`, background: color }} />
      </div>
    </div>
  );
}

function ExecutiveSignal(props: { title: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
      <div className="h-1 w-16 rounded-full" style={{ background: props.accent }} />
      <div className="mt-4 text-xs font-black uppercase tracking-[0.12em]" style={{ color: BRAND.greyBlue }}>
        {props.title}
      </div>
      <p className="mt-2 text-sm font-semibold leading-6" style={{ color: BRAND.text }}>{props.value}</p>
    </div>
  );
}

function ImpactCard(props: { title: string; text: string; tone?: "risk" }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: props.tone === "risk" ? "#FEDF89" : BRAND.border, background: props.tone === "risk" ? "#FFFCF5" : "#F9FAFB" }}>
      <div className="text-xs font-black uppercase tracking-[0.1em]" style={{ color: props.tone === "risk" ? "#B54708" : BRAND.greyBlue }}>
        {props.title}
      </div>
      <p className="mt-2 text-sm leading-6" style={{ color: BRAND.text }}>{props.text}</p>
    </div>
  );
}

function stripHtml(html: string) {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}

function FormattedNarrative(props: { text: string }) {
  const blocks = props.text
    .split(/\n{2,}/g)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) return null;

  return (
    <div className="grid gap-4">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const allBullets = lines.every((line) => line.startsWith("- "));
        const isHeading =
          lines.length === 1 &&
          !lines[0].startsWith("- ") &&
          lines[0].length <= 80 &&
          !/[.!?]$/.test(lines[0]);

        if (isHeading) {
          return (
            <h3 key={`${block}-${index}`} className="text-base font-black tracking-tight" style={{ color: BRAND.dark }}>
              {lines[0]}
            </h3>
          );
        }

        if (allBullets) {
          return (
            <ul key={`${block}-${index}`} className="grid gap-2">
              {lines.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-7" style={{ color: BRAND.text }}>
                  <span aria-hidden className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: BRAND.cyan }} />
                  <span>{line.replace(/^- /, "")}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`${block}-${index}`} className="text-sm leading-7" style={{ color: BRAND.text }}>
            {lines.join(" ")}
          </p>
        );
      })}
    </div>
  );
}

function severityColor(severity: string) {
  if (severity === "high") return { bg: "#FEE4E2", fg: "#B42318" };
  if (severity === "low") return { bg: "#ECFDF3", fg: "#027A48" };
  return { bg: "#FFFAEB", fg: "#B54708" };
}

function Info(props: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-[0.1em]" style={{ color: BRAND.greyBlue }}>{props.label}</div>
      <div className="mt-1 text-sm leading-6" style={{ color: BRAND.text }}>{props.value}</div>
    </div>
  );
}

function TextEdit(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.1em]" style={{ color: BRAND.greyBlue }}>{props.label}</span>
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: BRAND.border }} />
    </label>
  );
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
      <h3 className="text-lg font-semibold">{props.title}</h3>
      <div className="mt-4">{props.children}</div>
    </div>
  );
}
