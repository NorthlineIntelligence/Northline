"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Montserrat, Open_Sans } from "next/font/google";
import {
  NORTHLINE_BRAND as BRAND,
  NORTHLINE_GLASS_CARD as glassCard,
  NORTHLINE_SHELL_BG as shellBackground,
} from "@/lib/northlineBrand";
import { ExecutiveInsightsInstructions } from "@/components/executive-insights/ExecutiveInsightsInstructions";

const montserrat = Montserrat({ subsets: ["latin"], weight: ["700", "800", "900"], display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

type Analysis = {
  id: string;
  executiveSummary: string;
  overallSynergyScore: number;
  outputJson: {
    executiveReadout?: {
      headline?: string;
      executiveNarrative?: string;
      coreProblem?: string;
      strategicImplication?: string;
      decisionPoint?: string;
    };
  };
  createdAt: string;
  projects: Array<{
    id: string;
    rank: number;
    projectName: string;
    problemStatement: string;
    recommendedSolution: string;
    firstStep: string;
    priorityScore: number;
  }>;
};

export default function PriorityExecutiveInsightsPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const assessmentId = typeof params?.id === "string" ? params.id : "";

  const authQs = useMemo(() => {
    const qs = new URLSearchParams();
    const email = (searchParams.get("email") ?? "").trim();
    const token = (searchParams.get("token") ?? "").trim();
    if (email) qs.set("email", email);
    if (token) qs.set("token", token);
    const serialized = qs.toString();
    return serialized ? `?${serialized}` : "";
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [completion, setCompletion] = useState<{ participants_total: number; participants_completed: number; all_participants_completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!assessmentId) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/assessments/${assessmentId}/priority-insights${authQs}`, {
      credentials: "include",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? `Unable to open Executive Insights (${res.status}).`);
      setLoading(false);
      return;
    }
    setAnalysis(json.analysis ?? null);
    setCompletion(json.completion ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [assessmentId, authQs]);

  async function onGenerate() {
    if (!assessmentId) return;
    setGenerating(true);
    setError(null);
    const res = await fetch(`/api/assessments/${assessmentId}/priority-insights${authQs}`, {
      method: "POST",
      credentials: "include",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? `Generate failed (${res.status}).`);
      setGenerating(false);
      return;
    }
    setAnalysis(json.analysis ?? null);
    setCached(json.cached === true);
    setGenerating(false);
  }

  const readout = analysis?.outputJson?.executiveReadout;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: shellBackground,
        padding: "clamp(20px, 4vw, 40px)",
        fontFamily: openSans.style.fontFamily,
        color: BRAND.text,
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ ...glassCard, borderRadius: 20, padding: 28 }}>
          <div style={{ fontFamily: montserrat.style.fontFamily, fontSize: 28, fontWeight: 900, color: BRAND.dark }}>
            Executive Insights
          </div>
          <div style={{ marginTop: 8, color: BRAND.greyBlue, fontWeight: 600 }}>
            AI Priority Discovery executive readout
          </div>

          <ExecutiveInsightsInstructions />

          {completion ? (
            <div style={{ marginTop: 14, fontSize: 13, color: BRAND.greyBlue, fontWeight: 700 }}>
              Assessments completed: {completion.participants_completed}/{completion.participants_total}
            </div>
          ) : null}

          <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={generating || loading || Boolean(completion && !completion.all_participants_completed)}
              style={{
                background: BRAND.dark,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "12px 18px",
                fontWeight: 800,
                cursor: generating || loading ? "not-allowed" : "pointer",
                opacity: generating || loading ? 0.65 : 1,
              }}
            >
              {generating ? "Generating…" : analysis ? "Generated (locked)" : "Generate"}
            </button>
            {cached ? (
              <span style={{ alignSelf: "center", fontSize: 13, color: BRAND.greyBlue, fontWeight: 700 }}>
                Shared readout loaded
              </span>
            ) : null}
          </div>

          {error ? (
            <div style={{ marginTop: 16, color: "#b42318", fontWeight: 700 }}>{error}</div>
          ) : null}

          {loading ? (
            <div style={{ marginTop: 24, color: BRAND.greyBlue }}>Loading Executive Insights…</div>
          ) : null}

          {analysis ? (
            <div style={{ marginTop: 28, display: "grid", gap: 18 }}>
              {readout?.headline ? (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: BRAND.cyan, textTransform: "uppercase" }}>
                    Headline
                  </div>
                  <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, color: BRAND.dark }}>{readout.headline}</div>
                </section>
              ) : null}

              {readout?.executiveNarrative ? (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: BRAND.cyan, textTransform: "uppercase" }}>
                    Executive narrative
                  </div>
                  <div style={{ marginTop: 8, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{readout.executiveNarrative}</div>
                </section>
              ) : null}

              {analysis.executiveSummary ? (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: BRAND.cyan, textTransform: "uppercase" }}>
                    Executive summary
                  </div>
                  <div style={{ marginTop: 8, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{analysis.executiveSummary}</div>
                </section>
              ) : null}

              {analysis.projects.length > 0 ? (
                <section>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: BRAND.cyan, textTransform: "uppercase" }}>
                    Top priority projects
                  </div>
                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    {analysis.projects.map((project) => (
                      <div
                        key={project.id}
                        style={{
                          border: `1px solid ${BRAND.border}`,
                          borderRadius: 14,
                          padding: 16,
                          background: "#fff",
                        }}
                      >
                        <div style={{ fontWeight: 800, color: BRAND.dark }}>
                          #{project.rank} {project.projectName}
                        </div>
                        <div style={{ marginTop: 8, lineHeight: 1.6 }}>{project.problemStatement}</div>
                        <div style={{ marginTop: 8, fontSize: 13, color: BRAND.muted }}>
                          First step: {project.firstStep}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : !loading ? (
            <div style={{ marginTop: 24, color: BRAND.greyBlue }}>
              No executive readout has been generated yet. Click Generate when all assessments are complete.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
