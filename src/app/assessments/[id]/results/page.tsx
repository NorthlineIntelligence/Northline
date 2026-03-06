"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const BRAND = {
  dark: "#173464",
  cyan: "#34b0b4",
  greyBlue: "#66819e",
  bg: "#F6F8FC",
  card: "#FFFFFF",
  border: "#E6EAF2",
  text: "#0B1220",
  muted: "#4B5565",
  danger: "#b42318",
};

type NarrativeApiResponse =
  | { ok: true; cached: boolean; narrative: any }
  | { ok: false; error: string; message?: string };

type RadarPoint = {
  key: string;
  label: string;
  value: number; // 0..5
  color: string;
  bandKey: string;
  band: string | null;
};

const PILLAR_KEYS = [
  "SYSTEM_INTEGRITY",
  "HUMAN_ALIGNMENT",
  "STRATEGIC_COHERENCE",
  "SUSTAINABILITY_PRACTICE",
] as const;

function isoToPretty(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function prettyPillarLabel(key: string) {
  switch (key) {
    case "SYSTEM_INTEGRITY":
      return "System Integrity";
    case "HUMAN_ALIGNMENT":
      return "Human Alignment";
    case "STRATEGIC_COHERENCE":
      return "Strategic Coherence";
    case "SUSTAINABILITY_PRACTICE":
      return "Sustainability Practice";
    default:
      return key;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getAt(obj: any, path: (string | number)[]) {
  let cur = obj;
  for (const p of path) {
    if (cur == null) return undefined;
    cur = cur[p as any];
  }
  return cur;
}

function extractReadinessIndex(payload: any): number | null {
  const v = getAt(payload, ["aggregate", "overall", "weightedAverage"]);
  return typeof v === "number" ? v : null;
}

function extractPillarScore(payload: any, pillarKey: string): number | null {
  const v = getAt(payload, ["aggregate", "pillars", pillarKey, "weightedAverage"]);
  return typeof v === "number" ? v : null;
}

function buildRadarData(payload: any): RadarPoint[] {
  const legend = getAt(payload, ["bands", "legend"]) ?? {};
  const unknownColor = typeof legend?.unknown?.color === "string" ? legend.unknown.color : "#cdd8df";

  const bandInfo = (bandKey: string | undefined) => {
    const k = typeof bandKey === "string" ? bandKey : "unknown";
    const entry = legend?.[k];
    return {
      bandKey: k,
      band: typeof entry?.band === "string" ? entry.band : null,
      color: typeof entry?.color === "string" ? entry.color : unknownColor,
    };
  };

  const serverRadar = getAt(payload, ["reporting", "radar"]);
  const byKey = new Map<string, any>();

  if (Array.isArray(serverRadar)) {
    for (const r of serverRadar) {
      const k = String(r?.key ?? r?.label ?? "");
      if (k) byKey.set(k, r);
    }
  }

  // Always return all 4 pillars
  return PILLAR_KEYS.map((k) => {
    const r = byKey.get(k);

    const valueFromRadar = typeof r?.value === "number" ? r.value : null;
    const valueFromAggregate = extractPillarScore(payload, k);

    const value =
      typeof valueFromRadar === "number"
        ? valueFromRadar
        : typeof valueFromAggregate === "number"
          ? valueFromAggregate
          : 0;

    const b = bandInfo(r?.bandKey);

    return {
      key: k,
      label: prettyPillarLabel(k),
      value: clamp(value, 0, 5),
      color: typeof r?.color === "string" ? r.color : b.color,
      bandKey: b.bandKey,
      band: typeof r?.band === "string" ? r.band : b.band,
    };
  });
}

function severityStyle(severity: string | undefined) {
  const s = String(severity ?? "").toUpperCase();
  if (s === "HIGH")
    return { label: "HIGH", dot: "#b42318", border: "#FCA5A5", bg: "#FFF5F5", text: "#7F1D1D" };
  if (s === "MEDIUM")
    return { label: "MEDIUM", dot: "#d97706", border: "#FCD34D", bg: "#FFFBEB", text: "#7C2D12" };
  if (s === "LOW")
    return { label: "LOW", dot: "#16a34a", border: "#86EFAC", bg: "#F0FDF4", text: "#14532D" };
  return { label: s || "INFO", dot: "#64748B", border: BRAND.border, bg: "#F8FAFC", text: BRAND.muted };
}

function formatRiskDetails(details: any): string {
  if (!details || typeof details !== "object") return "";

  if (Array.isArray(details.pillars) && details.pillars.length > 0) {
    const parts = details.pillars
      .map((p: any) => {
        const name = typeof p?.pillar === "string" ? prettyPillarLabel(p.pillar) : "Pillar";
        const score = typeof p?.score === "number" ? p.score.toFixed(2) : null;
        return score ? `${name}: ${score}` : `${name}`;
      })
      .slice(0, 4);

    const rule = typeof details.rule === "string" ? `Rule: ${details.rule}` : "";
    return `${parts.join(" • ")}${rule ? ` — ${rule}` : ""}`;
  }

  if (typeof details.variance === "number") {
    const v = details.variance.toFixed(2);
    const rule = typeof details.rule === "string" ? `Rule: ${details.rule}` : "";
    const hi = typeof details.highest === "number" ? `Highest: ${details.highest}` : "";
    const lo = typeof details.lowest === "number" ? `Lowest: ${details.lowest}` : "";
    const extras = [hi, lo].filter(Boolean).join(" • ");
    return `Variance: ${v}${extras ? ` — ${extras}` : ""}${rule ? ` — ${rule}` : ""}`;
  }

  if (typeof details.rule === "string") return `Rule: ${details.rule}`;
  return "";
}

type RiskBrief = { signal: string; meaning: string; focus: string };

function briefForRiskFlag(rf: any): RiskBrief {
  const rule = typeof rf?.details?.rule === "string" ? rf.details.rule : "";
  const title = typeof rf?.title === "string" ? rf.title : "";

  if (rule === "any pillar < 2.0") {
    return {
      signal: "Minimum pillar threshold triggered",
      meaning:
        "One or more pillars are below the minimum readiness threshold. The overall index is intentionally constrained to prevent false confidence.",
      focus:
        "Address the lowest-scoring pillar with one concrete structural move (clarify owner, cadence, and definition of ‘done’).",
    };
  }

  if (rule === "variance (max-min) > 1.5") {
    return {
      signal: "Pillar imbalance detected",
      meaning:
        "Strength is uneven across pillars. This often creates friction: execution depends on the weak pillar, not the strong one.",
      focus: "Stabilize the lowest pillar first. Aim for a balanced baseline before pushing for speed or scale.",
    };
  }

  const hasPillarArray = Array.isArray(rf?.details?.pillars) && rf.details.pillars.length > 0;
  if (hasPillarArray) {
    return {
      signal: "Minimum pillar threshold triggered",
      meaning:
        "One or more pillars are below the minimum readiness threshold. The overall index is intentionally constrained to prevent false confidence.",
      focus:
        "Address the lowest-scoring pillar with one concrete structural move (clarify owner, cadence, and definition of ‘done’).",
    };
  }

  return {
    signal: title || "Structural risk signal detected",
    meaning:
      "A protective rule was triggered based on the current inputs. This is a signal to focus attention—not a judgement or failure state.",
    focus: "Review the trigger evidence and choose one stabilizing action that reduces uncertainty or strengthens ownership.",
  };
}

// ---- Minimal dependency-free Radar Chart (SVG) ----
function RadarChart({ data, size = 340, maxValue = 5 }: { data: RadarPoint[]; size?: number; maxValue?: number }) {
  const points = Array.isArray(data) ? data : [];
  const n = points.length;

  if (n < 3) {
    return <div style={{ color: BRAND.muted, fontWeight: 750 }}>Not enough data to render radar.</div>;
  }

  const pad = 120;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.3;
  const rings = [0.2, 0.4, 0.6, 0.8, 1];

  const angleForIndex = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const axisEnd = (i: number) => {
    const a = angleForIndex(i);
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
  };

  const valuePoint = (i: number, v: number) => {
    const a = angleForIndex(i);
    const r = (clamp(v, 0, maxValue) / maxValue) * radius;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  const polygon = points
    .map((p, i) => {
      const pt = valuePoint(i, p.value);
      return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {rings.map((t, idx) => {
        const r = radius * t;
        const ringPoly = points
          .map((_, i) => {
            const a = angleForIndex(i);
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ");
        return <polygon key={idx} points={ringPoly} fill="none" stroke={BRAND.border} strokeWidth={1} />;
      })}

      {points.map((_, i) => {
        const end = axisEnd(i);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke={BRAND.border} strokeWidth={1} />;
      })}

      <polygon points={polygon} fill="rgba(52, 176, 180, 0.18)" stroke={BRAND.dark} strokeWidth={2} />

      {points.map((p, i) => {
        const pt = valuePoint(i, p.value);
        return <circle key={p.key} cx={pt.x} cy={pt.y} r={4} fill={p.color} stroke="#ffffff" strokeWidth={2} />;
      })}

      {points.map((p, i) => {
        const a = angleForIndex(i);
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        const isRight = cos > 0.35;
        const isLeft = cos < -0.35;
        const isHorizontal = Math.abs(sin) < 0.3;

        const labelR = isHorizontal ? radius + 56 : radius + 30;
        const anchor: "start" | "end" | "middle" = isRight ? "start" : isLeft ? "end" : "middle";
        const nudgeX = isRight ? 14 : isLeft ? -14 : 0;

        const lx = cx + cos * labelR + nudgeX;
        const ly = cy + sin * labelR;

        const words = String(p.label).split(" ").filter(Boolean);
        const lines =
          words.length <= 1
            ? [p.label]
            : words.length === 2
              ? [words[0], words[1]]
              : [words.slice(0, -1).join(" "), words[words.length - 1]];

        const lineHeight = 12;
        const startY = lines.length === 1 ? ly : ly - lineHeight / 2;

        return (
          <text
            key={`${p.key}-label`}
            x={lx}
            y={startY}
            textAnchor={anchor as any}
            dominantBaseline="middle"
            fontSize={11}
            fontWeight={800}
            fill={BRAND.muted}
          >
            {lines.map((t, idx) => (
              <tspan key={idx} x={lx} dy={idx === 0 ? 0 : lineHeight}>
                {t}
              </tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function maturityBadgeStyle(tier: string | null | undefined) {
  const t = String(tier ?? "").toUpperCase();
  if (t === "FRAGMENTED") return { bg: "#FFF5F5", border: "#FCA5A5", text: "#7F1D1D" };
  if (t === "EMERGING") return { bg: "#FFFBEB", border: "#FCD34D", text: "#7C2D12" };
  if (t === "OPERATIONALIZING") return { bg: "#EFF6FF", border: "#93C5FD", text: "#1E3A8A" };
  if (t === "INSTITUTIONALIZED") return { bg: "#F0FDF4", border: "#86EFAC", text: "#14532D" };
  return { bg: "#F8FAFC", border: BRAND.border, text: BRAND.muted };
}

function inviteStorageKey(assessmentId: string) {
  return `nl_invite_auth_${assessmentId}`;
}

export default function AssessmentResultsPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const assessmentId = typeof params?.id === "string" && params.id.length > 0 ? params.id : null;

  const isPrint = searchParams?.get("print") === "1";

  // Persisted invite-link auth (so it survives navigation)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteToken, setInviteToken] = useState("");

  useEffect(() => {
    if (!assessmentId) return;

    const urlEmail = (searchParams?.get("email") ?? "").trim().toLowerCase();
    const urlToken = (searchParams?.get("token") ?? "").trim();

    // If URL has both, store them
    if (urlEmail && urlToken) {
      try {
        sessionStorage.setItem(inviteStorageKey(assessmentId), JSON.stringify({ email: urlEmail, token: urlToken }));
      } catch {}
      setInviteEmail(urlEmail);
      setInviteToken(urlToken);
      return;
    }

    // Otherwise, load from sessionStorage (if present)
    try {
      const raw = sessionStorage.getItem(inviteStorageKey(assessmentId));
      if (raw) {
        const parsed = JSON.parse(raw);
        const storedEmail = typeof parsed?.email === "string" ? parsed.email : "";
        const storedToken = typeof parsed?.token === "string" ? parsed.token : "";
        if (storedEmail && storedToken) {
          setInviteEmail(storedEmail);
          setInviteToken(storedToken);
        }
      }
    } catch {}
  }, [assessmentId, searchParams]);

  // Shared qs for API calls + links
  const authQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (inviteEmail) qs.set("email", inviteEmail);
    if (inviteToken) qs.set("token", inviteToken);
    return qs.toString();
  }, [inviteEmail, inviteToken]);

  const [resultsLoaded, setResultsLoaded] = useState(false);
  const [narrativeLoaded, setNarrativeLoaded] = useState(false);
  const [didAutoPrint, setDidAutoPrint] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [cached, setCached] = useState<boolean | null>(null);
  const [narrative, setNarrative] = useState<any | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const [diagnosticData, setDiagnosticData] = useState<any | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticErr, setDiagnosticErr] = useState<string | null>(null);
  const [didRetryResults, setDidRetryResults] = useState(false);

  const [showResultsDebug, setShowResultsDebug] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const [showProtectionMethod, setShowProtectionMethod] = useState(false);

  const narrativeJson = narrative?.narrative_json ?? null;

  // Fetch diagnostic results
  useEffect(() => {
    if (!assessmentId) return;

    const ctrl = new AbortController();
    let alive = true;

    async function fetchResults() {
      try {
        const url = `/api/assessments/${assessmentId}/results${authQs ? `?${authQs}` : ""}`;
        const res = await fetch(url, { credentials: "include", signal: ctrl.signal });

        if (!res.ok) {
          if (alive) setDiagnosticErr(`Results fetch failed (${res.status}).`);
          return;
        }

        const json = await res.json();
        if (!alive) return;

        setDiagnosticData(json);
      } catch (e: any) {
        if (!alive) return;
        if (e?.name === "AbortError") return;
        setDiagnosticErr(e?.message ?? "Results fetch failed.");
      } finally {
        if (!alive) return;
        setDiagnosticLoading(false);
        setResultsLoaded(true);
      }
    }

    setResultsLoaded(false);
    setDiagnosticLoading(true);
    setDiagnosticErr(null);
    fetchResults();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [assessmentId, authQs]);

  // Fetch latest narrative (auto-load on refresh)
  useEffect(() => {
    if (!assessmentId) return;

    const ctrl = new AbortController();
    let alive = true;

    async function fetchLatestNarrative() {
      try {
        const url = `/api/assessments/${assessmentId}/narrative${authQs ? `?${authQs}` : ""}`;
        const res = await fetch(url, {
          credentials: "include",
          signal: ctrl.signal,
        });

        if (res.status === 404) return;

        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) return;

        if (json && json.ok === true && json.narrative) {
          setNarrative(json.narrative);
          setCached(true);
        }
      } catch (e: any) {
        if (!alive) return;
        if (e?.name === "AbortError") return;
      } finally {
        if (!alive) return;
        setNarrativeLoaded(true);
      }
    }

    setNarrativeLoaded(false);
    fetchLatestNarrative();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [assessmentId, authQs]);

  // In print mode, wait until results + narrative have finished loading before invoking print.
  useEffect(() => {
    if (!isPrint) return;
    if (!assessmentId) return;
    if (didAutoPrint) return;
    if (!resultsLoaded) return;
    if (!narrativeLoaded) return;

    setDidAutoPrint(true);
    const t = window.setTimeout(() => {
      window.print();
    }, 250);

    return () => window.clearTimeout(t);
  }, [isPrint, assessmentId, didAutoPrint, resultsLoaded, narrativeLoaded]);

  const radarData = useMemo(() => buildRadarData(diagnosticData), [diagnosticData]);
  const readinessIndex = useMemo(() => extractReadinessIndex(diagnosticData), [diagnosticData]);

  const protectionExplanation = useMemo(() => {
    const v = diagnosticData?.protectionExplanation;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }, [diagnosticData]);

  const maturity = useMemo(() => {
    const m = diagnosticData?.maturity;
    if (!m || typeof m !== "object") return null;

    const label = typeof m.label === "string" ? m.label : null;
    const posture = typeof m.posture === "string" ? m.posture : null;
    const tier = typeof m.tier === "string" ? m.tier : null;
    const tierScore = typeof m.tierScore === "number" ? m.tierScore : null;

    if (!label && !posture && !tier) return null;
    return { label, posture, tier, tierScore };
  }, [diagnosticData]);

  const riskFlags: any[] = useMemo(() => {
    const arr = diagnosticData?.riskFlags;
    return Array.isArray(arr) ? arr : [];
  }, [diagnosticData]);

  const executiveBullets: string[] = useMemo(() => {
    const arr = narrativeJson?.executiveSummaryBullets;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  }, [narrativeJson]);

  const missingInputs: string[] = useMemo(() => {
    const arr = narrativeJson?.missingInputs;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  }, [narrativeJson]);

  // Fallback (no narrative yet): build a minimal executive summary from results
  const fallbackExecutiveBullets: string[] = useMemo(() => {
    const bullets: string[] = [];

    const ri = typeof readinessIndex === "number" && Number.isFinite(readinessIndex) ? readinessIndex.toFixed(1) : null;

    const maturityLabel = maturity?.label ?? null;

    if (ri && maturityLabel) {
      bullets.push(`Current readiness is ${ri}/5.0 with maturity classified as ${maturityLabel}.`);
    } else if (ri) {
      bullets.push(`Current readiness is ${ri}/5.0 (protected index; see method for constraints).`);
    } else if (maturityLabel) {
      bullets.push(`Maturity is classified as ${maturityLabel}; readiness index is not available yet.`);
    } else {
      bullets.push(`Results are available, but summary signals are still consolidating.`);
    }

    if (riskFlags.length === 0) {
      bullets.push(`No structural risk signals were triggered for the current inputs.`);
    } else {
      const topSignals = riskFlags
        .slice(0, 2)
        .map((rf: any) => briefForRiskFlag(rf).signal)
        .filter(Boolean);

      if (topSignals.length > 0) {
        bullets.push(`Top structural signals: ${topSignals.join(" • ")}.`);
      } else {
        bullets.push(`Structural risk signals were triggered; review evidence for the most actionable constraints.`);
      }
    }

    const lowest = [...radarData].sort((a, b) => a.value - b.value)[0];
    if (lowest?.label) {
      bullets.push(`Primary focus area: strengthen ${lowest.label} first to reduce constraint and improve balance.`);
    }

    return bullets.slice(0, 4);
  }, [readinessIndex, maturity, riskFlags, radarData]);

  const recommendedNextActions: string[] = useMemo(() => {
    // Prefer narrative-provided actions if available
    const narrativeActionsRaw =
      narrativeJson?.recommendedNextActions ??
      narrativeJson?.recommended_actions ??
      narrativeJson?.nextActions ??
      narrativeJson?.next_actions;

    const narrativeActions = Array.isArray(narrativeActionsRaw)
      ? narrativeActionsRaw.filter((x) => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
      : [];

    if (narrativeActions.length > 0) return narrativeActions.slice(0, 3);

    // Fallback actions derived from results
    const actions: string[] = [];

    const lowest = [...radarData].sort((a, b) => a.value - b.value)[0];
    if (lowest?.label) {
      actions.push(`Stabilize ${lowest.label}: assign a single owner, set a weekly cadence, and define “done” for the next 14 days.`);
    }

    if (riskFlags.length > 0) {
      const focuses = riskFlags
        .slice(0, 2)
        .map((rf: any) => briefForRiskFlag(rf).focus)
        .filter((x: any) => typeof x === "string" && x.trim().length > 0);

      for (const f of focuses) actions.push(f.trim());
    }

    if (actions.length === 0) {
      actions.push(`Confirm inputs are complete, then generate the narrative memo for a more specific action plan.`);
    }

    // de-dupe and cap to 3
    const unique = Array.from(new Set(actions));
    return unique.slice(0, 3);
  }, [narrativeJson, radarData, riskFlags]);

  async function onGenerate() {
    if (!assessmentId) {
      setErr("Missing assessment id in route.");
      return;
    }

    setSubmitting(true);
    setErr(null);

    try {
      const url = `/api/assessments/${assessmentId}/narrative${authQs ? `?${authQs}` : ""}`;

      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
      });

      const json = (await res.json().catch(() => null)) as NarrativeApiResponse | null;

      // Special case: server-enforced policy returns 409 with the latest narrative included.
      // Treat this as "load existing narrative" so Raw JSON can be viewed and the button locks.
      if (res.status === 409 && json && (json as any)?.narrative) {
        setErr(null);
        setCached(true);
        setNarrative((json as any).narrative);
        return;
      }

      // Completion gate: show friendly message
      const msg = String((json as any)?.error ?? (json as any)?.message ?? "");
      if (!res.ok && msg.includes("All participants have not completed the assessment")) {
        setErr(
          "All participants have not completed the assessment.\n\nPlease check back once the administrator confirms completion."
        );
        return;
      }

      if (!res.ok || !json) {
        setErr((json as any)?.error ?? (json as any)?.message ?? `Generate failed (${res.status}).`);
        return;
      }

      if (!("ok" in json) || (json as any).ok !== true) {
        setErr((json as any)?.error ?? "Generate failed.");
        return;
      }

      setCached((json as any).cached);
      setNarrative((json as any).narrative);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const legend = diagnosticData?.bands?.legend ?? null;

  const orgName =
    typeof diagnosticData?.organizationName === "string" && diagnosticData.organizationName.trim()
      ? diagnosticData.organizationName.trim()
      : "No org name present";

  return (
    <>
      <style>
        {`
         .print-header { display: none; }

         @media print {
           /* Repeat header on every printed page */
           .print-header {
             display: block;
             position: fixed;
             top: 0;
             left: 0;
             right: 0;
             background: #ffffff;
             padding: 18px 0 14px 0;
             border-bottom: 1px solid ${BRAND.border};
             z-index: 9999;
           }

           /* Make room so content doesn't slide under the fixed header */
           .print-content { padding-top: 148px !important; }
           .print-section {
             break-inside: avoid;
             page-break-inside: avoid;
           }
         }
       `}
      </style>

      <main
        style={{
          minHeight: "100vh",
          background: BRAND.bg,
          padding: 32,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          color: BRAND.text,
        }}
      >
        <div className="print-content" style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="print-header">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 980, color: BRAND.dark }}>Northline Intelligence</div>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 980, color: BRAND.dark }}>Executive Insights</div>
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, color: BRAND.dark }}>{orgName}</div>

                <div style={{ marginTop: 2, fontSize: 12, fontWeight: 800, color: BRAND.greyBlue }}>
                  Assessment: {assessmentId ?? "—"}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: BRAND.greyBlue }}>Version</div>
                <div style={{ marginTop: 4, fontSize: 14, fontWeight: 980, color: BRAND.dark }}>
                  {narrative ? `v${narrative.version}` : "—"}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, fontWeight: 850, color: BRAND.greyBlue }}>
                  Generated: {narrative ? isoToPretty(narrative.created_at) : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Masthead */}
          <div
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
              position: "sticky",
              top: 16,
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: "1 1 360px" }}>
                <div style={{ fontSize: 22, fontWeight: 980, color: BRAND.dark }}>Northline Executive Insights</div>
                <div style={{ marginTop: 4, color: BRAND.muted, fontWeight: 700 }}>Strategic intelligence layer</div>

                {/* Org name stacked over Assessment ID */}
                <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                  <div style={{ color: BRAND.dark, fontSize: 14, fontWeight: 900 }}>{orgName}</div>
                  <div style={{ color: BRAND.greyBlue, fontSize: 12, fontWeight: 800 }}>
                    Assessment: {assessmentId ?? "—"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <a
                  href={assessmentId ? `/assessments/${assessmentId}/narrative${authQs ? `?${authQs}` : ""}` : "#"}
                  style={{
                    background: "#FFFFFF",
                    color: BRAND.dark,
                    border: `1px solid ${BRAND.border}`,
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontWeight: 850,
                    cursor: assessmentId ? "pointer" : "not-allowed",
                    textDecoration: "none",
                    display: "inline-block",
                    opacity: assessmentId ? 1 : 0.6,
                  }}
                >
                  Executive Insights →
                </a>

                <button
                  onClick={onGenerate}
                  disabled={submitting || !assessmentId || !!narrative}
                  style={{
                    background: BRAND.cyan,
                    color: BRAND.dark,
                    border: `1px solid ${BRAND.border}`,
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontWeight: 950,
                    cursor: submitting || !assessmentId || !!narrative ? "not-allowed" : "pointer",
                    opacity: submitting || !assessmentId || !!narrative ? 0.6 : 1,
                  }}
                  title={narrative ? "This narrative is locked once generated." : "Generate the narrative artifact."}
                >
                  {submitting ? "Generating…" : narrative ? "Generated (locked)" : "Generate"}
                </button>

                <button
                  onClick={() => setShowRaw((s) => !s)}
                  disabled={!narrative}
                  style={{
                    background: BRAND.dark,
                    color: "white",
                    border: "none",
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontWeight: 850,
                    cursor: narrative ? "pointer" : "not-allowed",
                    opacity: narrative ? 1 : 0.6,
                  }}
                >
                  {showRaw ? "Hide Raw" : "Raw JSON"}
                </button>

                <button
                  onClick={() => setShowResultsDebug((s) => !s)}
                  disabled={!diagnosticData}
                  style={{
                    background: "#64748B",
                    color: "white",
                    border: "none",
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontWeight: 850,
                    cursor: diagnosticData ? "pointer" : "not-allowed",
                    opacity: diagnosticData ? 1 : 0.6,
                  }}
                >
                  {showResultsDebug ? "Hide Results Debug" : "Results Debug"}
                </button>
              </div>
            </div>
          </div>

          {err ? (
            <div
              style={{
                marginTop: 16,
                background: "#FFF5F5",
                border: "1px solid #FED7D7",
                borderRadius: 14,
                padding: 14,
                color: BRAND.danger,
                fontWeight: 850,
                whiteSpace: "pre-line",
              }}
            >
              {err}
            </div>
          ) : null}

          {diagnosticErr ? (
            <div
              style={{
                marginTop: 16,
                background: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: 14,
                padding: 14,
                color: "#7C2D12",
                fontWeight: 850,
              }}
            >
              Diagnostics warning: {diagnosticErr} {didRetryResults ? "(retried once)" : ""}
            </div>
          ) : null}

          <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
            {/* Status */}
            <section
              className="print-section"
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 900 }}>Insight Status</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 980, color: BRAND.dark }}>
                    {narrative ? "Active" : "Not generated yet"}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 900 }}>Version / Cached</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 980, color: BRAND.dark }}>
                    {narrative ? `v${narrative.version}` : "—"} {cached === null ? "" : cached ? "(cached)" : "(new)"}
                  </div>
                  <div style={{ marginTop: 4, color: BRAND.greyBlue, fontSize: 12, fontWeight: 800 }}>
                    Created: {narrative ? isoToPretty(narrative.created_at) : "—"}
                  </div>
                </div>
              </div>

              {!narrative ? (
                <div style={{ marginTop: 12, color: BRAND.muted, fontWeight: 750, lineHeight: 1.4 }}>
                  Click <b>Generate / Refresh</b> to create the memo artifact. Outputs are versioned and cached by input
                  hash (same inputs → same output).
                </div>
              ) : null}
            </section>

            {/* Executive Summary */}
            <section
              className="print-section"
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 980 }}>Executive Summary</h2>

              {(() => {
                const bullets = executiveBullets.length > 0 ? executiveBullets : fallbackExecutiveBullets;

                return (
                  <ul style={{ marginTop: 12, paddingLeft: 18, color: BRAND.text, fontWeight: 800, lineHeight: 1.5 }}>
                    {bullets.map((b, i) => (
                      <li key={`${i}-${b}`}>{b}</li>
                    ))}
                  </ul>
                );
              })()}
            </section>

            {/* Recommended Next Actions */}
            <section
              className="print-section"
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 980 }}>Recommended Next Actions</h2>
              <div style={{ marginTop: 6, color: BRAND.muted, fontWeight: 700 }}>
                Concrete moves to reduce constraint and increase confidence.
              </div>

              <ol style={{ marginTop: 12, paddingLeft: 18, color: BRAND.text, fontWeight: 800, lineHeight: 1.5 }}>
                {recommendedNextActions.map((a, i) => (
                  <li key={`${i}-${a}`}>{a}</li>
                ))}
              </ol>
            </section>

            {/* Structural Profile */}
            <section
              className="print-section"
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 900 }}>Structural Profile</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 980, color: BRAND.dark }}>
                    Northline Readiness Index & Pillar Balance
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 900 }}>Readiness Index</div>

                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      gap: 10,
                      justifyContent: "flex-end",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontSize: 18, fontWeight: 980, color: BRAND.dark }}>
                      {typeof readinessIndex === "number" ? readinessIndex.toFixed(1) : "—"}
                    </div>

                    {maturity ? (
                      <div
                        title={[
                          maturity.label,
                          maturity.posture ? `• ${maturity.posture}` : "",
                          typeof maturity.tierScore === "number" ? `• ${maturity.tierScore.toFixed(1)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ")
                          .trim()}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: `1px solid ${maturityBadgeStyle(maturity.tier).border}`,
                          background: maturityBadgeStyle(maturity.tier).bg,
                          color: maturityBadgeStyle(maturity.tier).text,
                          fontWeight: 950,
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ fontWeight: 980 }}>{maturity.label ?? "Maturity"}</span>
                        {maturity.posture ? <span style={{ opacity: 0.9, fontWeight: 850 }}>• {maturity.posture}</span> : null}
                      </div>
                    ) : null}
                  </div>

                  {/* Protected score explanation */}
                  <div style={{ marginTop: 6 }}>
                    <div style={{ color: BRAND.greyBlue, fontSize: 12, fontWeight: 800 }}>
                      Index is protected to prevent false confidence.
                    </div>

                    {protectionExplanation ? (
                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          onClick={() => setShowProtectionMethod((s) => !s)}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: BRAND.dark,
                            fontWeight: 950,
                            cursor: "pointer",
                            fontSize: 12,
                            textDecoration: "underline",
                            textUnderlineOffset: 3,
                          }}
                        >
                          {showProtectionMethod ? "Hide method" : "Show method"}
                        </button>

                        {showProtectionMethod ? (
                          <div
                            style={{
                              marginTop: 8,
                              border: `1px solid ${BRAND.border}`,
                              background: "#F8FAFC",
                              borderRadius: 12,
                              padding: 10,
                              color: BRAND.muted,
                              fontWeight: 750,
                              fontSize: 12,
                              lineHeight: 1.4,
                              maxWidth: 420,
                              marginLeft: "auto",
                            }}
                          >
                            {protectionExplanation}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                {diagnosticLoading && !diagnosticData ? (
                  <div style={{ color: BRAND.muted, fontWeight: 750 }}>Loading diagnostic structure…</div>
                ) : (
                  <RadarChart data={radarData} />
                )}
              </div>

              {/* Legend */}
              {legend ? (
                <div
                  style={{
                    marginTop: 14,
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  {(["stabilize", "proceed", "ready"] as const).map((k) => (
                    <div
                      key={k}
                      style={{
                        border: `1px solid ${BRAND.border}`,
                        borderRadius: 12,
                        padding: 10,
                        fontWeight: 850,
                        color: BRAND.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: legend?.[k]?.color ?? "#cdd8df",
                          display: "inline-block",
                        }}
                      />
                      {legend?.[k]?.band ?? k}
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Debug */}
              {showResultsDebug && diagnosticData ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: BRAND.greyBlue }}>Results Debug</div>
                  <pre
                    style={{
                      marginTop: 8,
                      marginBottom: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 11,
                      background: "#0B1220",
                      color: "#E6EAF2",
                      padding: 12,
                      borderRadius: 12,
                      maxHeight: 320,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(diagnosticData, null, 2)}
                  </pre>
                </div>
              ) : null}
            </section>

            {/* Risk Signals */}
            <section
              className="print-section"
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 980 }}>Risk Signals</h2>
                  <div style={{ marginTop: 6, color: BRAND.muted, fontWeight: 750, lineHeight: 1.35 }}>
                    These are <b>structural signals</b> triggered by protective rules. They indicate where focus creates
                    stability — not “bad news.”
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 900 }}>Signals Detected</div>
                  <div style={{ marginTop: 6, fontSize: 18, fontWeight: 980, color: BRAND.dark }}>{riskFlags.length}</div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {riskFlags.length === 0 ? (
                  <div style={{ color: BRAND.muted, fontWeight: 750 }}>No risk signals detected for current inputs.</div>
                ) : (
                  riskFlags.map((rf: any, idx: number) => {
                    const st = severityStyle(rf?.severity);
                    const brief = briefForRiskFlag(rf);

                    const rawTitle = typeof rf?.title === "string" ? rf.title : "Risk Signal";
                    const key = String(rf?.key ?? rf?.details?.rule ?? `${rawTitle}-${idx}`);

                    const cardId = key;
                    const isOpen = !!openEvidence[cardId];

                    const evidence = formatRiskDetails(rf?.details);
                    const triggerRule = typeof rf?.details?.rule === "string" ? rf.details.rule : null;

                    return (
                      <div
                        key={key}
                        style={{
                          border: `1px solid ${st.border}`,
                          background: "#ffffff",
                          borderRadius: 14,
                          padding: 14,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: st.dot,
                                display: "inline-block",
                              }}
                            />
                            <div style={{ fontWeight: 980, color: BRAND.dark, fontSize: 14 }}>{brief.signal}</div>
                          </div>

                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: `1px solid ${st.border}`,
                              background: st.bg,
                              fontWeight: 950,
                              color: st.text,
                              fontSize: 12,
                            }}
                          >
                            {st.label}
                          </div>
                        </div>

                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 950, color: BRAND.greyBlue }}>Meaning</div>
                            <div style={{ marginTop: 4, color: BRAND.text, fontWeight: 750, lineHeight: 1.45 }}>
                              {brief.meaning}
                            </div>
                          </div>

                          <div>
                            <div style={{ fontSize: 12, fontWeight: 950, color: BRAND.greyBlue }}>Recommended focus</div>
                            <div style={{ marginTop: 4, color: BRAND.text, fontWeight: 800, lineHeight: 1.45 }}>
                              {brief.focus}
                            </div>
                          </div>

                          {evidence || triggerRule ? (
                            <div style={{ marginTop: 10 }}>
                              <button
                                type="button"
                                onClick={() => setOpenEvidence((prev) => ({ ...prev, [cardId]: !prev[cardId] }))}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  padding: 0,
                                  color: BRAND.greyBlue,
                                  fontWeight: 900,
                                  cursor: "pointer",
                                  fontSize: 12,
                                }}
                              >
                                {isOpen ? "Hide evidence" : "Show evidence"}
                              </button>

                              {isOpen ? (
                                <div
                                  style={{
                                    marginTop: 8,
                                    paddingTop: 10,
                                    borderTop: `1px dashed ${BRAND.border}`,
                                    color: BRAND.muted,
                                    fontWeight: 700,
                                    fontSize: 12,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {evidence ? <div>{evidence}</div> : null}
                                  {triggerRule ? (
                                    <div style={{ marginTop: evidence ? 6 : 0 }}>
                                      Trigger: <span style={{ fontWeight: 900 }}>{triggerRule}</span>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Missing Inputs */}
            <section
              className="print-section"
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 980 }}>Missing Inputs</h2>
              <div style={{ marginTop: 6, color: BRAND.muted, fontWeight: 700 }}>
                Memo must be conservative; missing context is explicitly called out.
              </div>

              {missingInputs.length === 0 ? (
                <div style={{ marginTop: 10, color: BRAND.muted, fontWeight: 750 }}>None listed (generate first).</div>
              ) : (
                <ul style={{ marginTop: 12, paddingLeft: 18, color: BRAND.text, fontWeight: 800, lineHeight: 1.5 }}>
                  {missingInputs.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* Raw Narrative */}
            {showRaw && narrative ? (
              <section
                style={{
                  background: BRAND.card,
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: 16,
                  padding: 20,
                  boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
                }}
              >
                <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 980 }}>Raw Narrative Artifact</h2>
                <pre
                  style={{
                    marginTop: 12,
                    marginBottom: 0,
                    whiteSpace: "pre-wrap",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 12,
                    background: "#0B1220",
                    color: "#E6EAF2",
                    padding: 14,
                    borderRadius: 12,
                    overflowX: "auto",
                  }}
                >
                  {JSON.stringify(narrative, null, 2)}
                </pre>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}