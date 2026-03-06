"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { briefForRiskFlag } from "@/lib/riskBriefs";
import { Montserrat } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  display: "swap",
});

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
  if (s === "HIGH") {
    return { label: "HIGH", dot: "#b42318", border: "#FCA5A5", bg: "#FFF5F5", text: "#7F1D1D" };
  }
  if (s === "MEDIUM") {
    return { label: "MEDIUM", dot: "#d97706", border: "#FCD34D", bg: "#FFFBEB", text: "#7C2D12" };
  }
  if (s === "LOW") {
    return { label: "LOW", dot: "#16a34a", border: "#86EFAC", bg: "#F0FDF4", text: "#14532D" };
  }
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

// ---- Minimal dependency-free Radar Chart (SVG) ----
function RadarChart({
  data,
  size = 520,
  maxValue = 5,
}: {
  data: RadarPoint[];
  size?: number;
  maxValue?: number;
}) {
  const points = Array.isArray(data) ? data : [];
  const n = points.length;

  if (n < 3) {
    return <div style={{ color: BRAND.muted, fontWeight: 750 }}>Not enough data to render radar.</div>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38;
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
      viewBox={`0 0 ${size} ${size}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ overflow: "visible" }}
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

  // push label slightly outward from center so it doesn't sit on the dot
  const a = angleForIndex(i);
  const offset = 16; // tweak for spacing
  const lx = pt.x + Math.cos(a) * offset;
  const ly = pt.y + Math.sin(a) * offset;

  return (
    <g key={p.key}>
      <circle
        cx={pt.x}
        cy={pt.y}
        r={5}
        fill={p.color}
        stroke="#ffffff"
        strokeWidth={2}
      />

      {/* label "pill" behind the number */}
      <rect
        x={lx - 16}
        y={ly - 12}
        width={32}
        height={22}
        rx={11}
        fill="#FFFFFF"
        stroke={BRAND.border}
        strokeWidth={1}
        opacity={0.95}
      />

      {/* numeric value */}
      <text
        x={lx}
        y={ly + 4}
        textAnchor="middle"
        fontSize={12}
        fontWeight={900}
        fill={BRAND.dark}
      >
        {p.value.toFixed(1)}
      </text>
    </g>
  );
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

  // ✅ Only bump the bottom label ("Strategic Coherence") down
  const yOffset = p.key === "STRATEGIC_COHERENCE" ? 28 : 0;

  const words = String(p.label).split(" ").filter(Boolean);
  const lines =
    words.length <= 1
      ? [p.label]
      : words.length === 2
        ? [words[0], words[1]]
        : [words.slice(0, -1).join(" "), words[words.length - 1]];

  const lineHeight = 30;
  const startY = lines.length === 1 ? ly : ly - lineHeight / 2;

  return (
    <text
      key={`${p.key}-label`}
      x={lx}
      y={startY + yOffset}
      textAnchor={anchor}
      dominantBaseline="middle"
      fontSize={26}
      fontWeight={800}
      fill={BRAND.dark}
    >
      {lines.map((t, idx2) => (
        <tspan key={idx2} x={lx} dy={idx2 === 0 ? 0 : lineHeight}>
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

function parseMemoSections(raw: string): Array<{ title: string; body: string[] }> {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sections: Array<{ title: string; body: string[] }> = [];

  let currentTitle = "Executive Narrative";
  let currentBody: string[] = [];

  const isHeading = (line: string) => {
    const h = line.toLowerCase();
    return (
      h === "executive narrative" ||
      h === "structured pillar breakdown" ||
      h === "risk interpretation" ||
      h === "northline high-value entry points" ||
      h === "suggested sequencing"
    );
  };

  for (const line of lines) {
    if (!line) continue;

    if (isHeading(line)) {
      if (currentBody.length > 0) sections.push({ title: currentTitle, body: currentBody });
      currentTitle = line;
      currentBody = [];
      continue;
    }

    const cleaned = line.replace(/^[-•]\s+/, "").trim();
    currentBody.push(cleaned);
  }

  if (currentBody.length > 0) sections.push({ title: currentTitle, body: currentBody });
  return sections;
}

function riskPillarsFromFlags(riskFlags: any[]): string[] {
  const out = new Set<string>();

  for (const rf of riskFlags || []) {
    const details = rf?.details;

    if (Array.isArray(details?.pillars)) {
      for (const p of details.pillars) {
        if (typeof p?.pillar === "string") out.add(p.pillar);
      }
    }

    if (rf?.key === "STRUCTURAL_IMBALANCE") out.add("CROSS_PILLAR");
    if (rf?.key === "ADOPTION_RISK") {
      out.add("HUMAN_ALIGNMENT");
      out.add("SYSTEM_INTEGRITY");
    }
  }

  return Array.from(out);
}

function prettyRiskPillarLabel(key: string) {
  if (key === "CROSS_PILLAR") return "Cross-pillar";
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function chunkTextForExecRead(raw: string): { lead: string; paras: string[] } {
  const text = String(raw ?? "").trim();
  if (!text) return { lead: "", paras: [] };

  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return { lead: text, paras: [] };

  const leadCount = sentences.length >= 2 ? 2 : 1;
  const lead = sentences.slice(0, leadCount).join(" ");

  const rest = sentences.slice(leadCount);
  const paras: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    paras.push(rest.slice(i, i + 2).join(" "));
  }

  return { lead, paras };
}

function inviteStorageKey(assessmentId: string) {
  return `nl_invite_auth_${assessmentId}`;
}
function formatScore(n: number | null | undefined) {
    return typeof n === "number" && Number.isFinite(n) ? n.toFixed(1) : "—";
  }
  
  function bandForValue(v: number) {
    if (v >= 3.75) return { label: "Ready", color: "#16a34a", bg: "#F0FDF4", border: "#86EFAC" };
    if (v >= 2.75) return { label: "Proceed", color: "#d97706", bg: "#FFFBEB", border: "#FCD34D" };
    return { label: "Stabilize", color: "#b42318", bg: "#FFF5F5", border: "#FCA5A5" };
  }
  
  function PillarRow({
    label,
    value,
  }: {
    label: string;
    value: number;
  }) {
    const pct = Math.max(0, Math.min(100, (value / 5) * 100));
    const b = bandForValue(value);
  
    return (
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 52px", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>{label}</div>
  
        <div style={{ height: 10, borderRadius: 999, background: "#EEF2F7", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: b.color, opacity: 0.9 }} />
        </div>
  
        <div style={{ textAlign: "right", fontSize: 12, fontWeight: 900, color: "#0B1220" }}>
          {value.toFixed(1)}
        </div>
      </div>
    );
  }
export default function AssessmentNarrativePage() {
  const params = useParams<{ id: string }>();
  const assessmentId = typeof params?.id === "string" && params.id.length > 0 ? params.id : null;

  const searchParams = useSearchParams();
  const isPrint = searchParams.get("print") === "1";

  // Persisted invite-link auth (so it survives navigation)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteToken, setInviteToken] = useState("");

  useEffect(() => {
    if (!assessmentId) return;

    const urlEmail = (searchParams.get("email") ?? "").trim().toLowerCase();
    const urlToken = (searchParams.get("token") ?? "").trim();

    if (urlEmail && urlToken) {
      try {
        sessionStorage.setItem(inviteStorageKey(assessmentId), JSON.stringify({ email: urlEmail, token: urlToken }));
      } catch {}
      setInviteEmail(urlEmail);
      setInviteToken(urlToken);
      return;
    }

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

  // Build a shared qs for API calls + links
  const authQs = useMemo(() => {
    const qs = new URLSearchParams();
    if (inviteEmail) qs.set("email", inviteEmail);
    if (inviteToken) qs.set("token", inviteToken);
    return qs.toString(); // "email=...&token=..."
  }, [inviteEmail, inviteToken]);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [cached, setCached] = useState<boolean | null>(null);
  const [narrative, setNarrative] = useState<any | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const [narrativeLoaded, setNarrativeLoaded] = useState(false);

  const [showAdminControls, setShowAdminControls] = useState(false);

  const [diagnosticData, setDiagnosticData] = useState<any | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticErr, setDiagnosticErr] = useState<string | null>(null);
  const [didRetryResults, setDidRetryResults] = useState(false);

  const [showResultsDebug, setShowResultsDebug] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const [showProtectionMethod, setShowProtectionMethod] = useState(false);

  const narrativeJson = narrative?.narrative_json ?? null;

  // Admin controls gate
  useEffect(() => {
    const flag =
      diagnosticData?.show_admin_controls ??
      diagnosticData?.assessment?.organization?.show_admin_controls ??
      false;

    setShowAdminControls(Boolean(flag));
  }, [diagnosticData]);
// Completion stats (from /api/assessments/[id]/results)



const allParticipantsCompleted =
  typeof diagnosticData?.all_participants_completed === "boolean"
    ? diagnosticData.all_participants_completed
    : null;

// Only lock non-admin viewers
const participantLocked = !showAdminControls && allParticipantsCompleted === false;
const hasInviteAuth = Boolean(inviteEmail && inviteToken);
const canAttemptGenerate = Boolean(assessmentId) && (showAdminControls || hasInviteAuth);
  // Results loader (retry once on 404)
  useEffect(() => {
    if (!assessmentId) return;

    const ctrl = new AbortController();
    let alive = true;

    async function fetchResultsWithRetry() {
      setDiagnosticLoading(true);
      setDiagnosticErr(null);
      setDidRetryResults(false);

      const url = `/api/assessments/${assessmentId}/results${authQs ? `?${authQs}` : ""}`;

      try {
        let res = await fetch(url, { credentials: "include", signal: ctrl.signal });

        if (res.status === 404) {
          setDidRetryResults(true);
          await sleep(350);
          if (ctrl.signal.aborted) return;
          res = await fetch(url, { credentials: "include", signal: ctrl.signal });
        }

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
        if (alive) setDiagnosticLoading(false);
      }
    }

    fetchResultsWithRetry();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [assessmentId, authQs]);

  // Fetch latest narrative (auto-load on refresh / print)
  useEffect(() => {
    if (!assessmentId) return;

    const ctrl = new AbortController();
    let alive = true;

    async function fetchLatestNarrative() {
      try {
        const res = await fetch(
          `/api/assessments/${assessmentId}/narrative${authQs ? `?${authQs}` : ""}`,
          {
            credentials: "include",
            signal: ctrl.signal,
          }
        );

        // If no narrative exists yet, we still consider "loaded" so UI can show the empty state.
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

  // Print only after diagnostics + narrative have finished loading
  useEffect(() => {
    if (!isPrint) return;
    if (diagnosticLoading) return;
    if (!diagnosticData) return;
    if (!narrativeLoaded) return;

    // If there's no narrative yet, don't auto-print a "blank" memo.
    if (!narrative) return;

    const t = setTimeout(() => {
      try {
        window.print();
      } catch {}
    }, 900);

    return () => clearTimeout(t);
  }, [isPrint, diagnosticLoading, diagnosticData, narrativeLoaded, narrative]);

  const radarData = useMemo(() => buildRadarData(diagnosticData), [diagnosticData]);
  const readinessIndex = useMemo(() => extractReadinessIndex(diagnosticData), [diagnosticData]);

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

  const missingInputs: string[] = useMemo(() => {
    const arr = narrativeJson?.missingInputs;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  }, [narrativeJson]);

  async function onGenerate() {
    if (!assessmentId) {
      setErr("Missing assessment id in route.");
      return;
    }
    if (participantLocked) {
        setErr(
          "All participants have not completed the assessment.\n\nPlease check back once the administrator confirms completion."
        );
        return;
      }
    setSubmitting(true);
    setErr(null);

    try {
      const qs = new URLSearchParams();

      // Invite auth (if present)
      if (inviteEmail) qs.set("email", inviteEmail);
      if (inviteToken) qs.set("token", inviteToken);

      // Admin-only extras
      if (showAdminControls) {
        qs.set("force", "1");
        qs.set("draft", "1");
      }

      const res = await fetch(
        `/api/assessments/${assessmentId}/narrative/generate${qs.toString() ? `?${qs.toString()}` : ""}`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const json = (await res.json().catch(() => null)) as NarrativeApiResponse | null;

      const msg = String((json as any)?.error ?? (json as any)?.message ?? "");

      // Completion gate: show friendly message
      if (!res.ok && msg.includes("All participants have not completed the assessment")) {
        setErr(
          "All participants have not completed the assessment.\n\nPlease check back once the administrator confirms completion."
        );
        return;
      }

      // If invite auth is missing and server says unauthorized, show an invite-link hint
      if (res.status === 401 && (!inviteEmail || !inviteToken)) {
        setErr("This page needs an invite link (with ?email=...&token=...) OR an admin login session.");
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
  const protectionExplanation =
    typeof diagnosticData?.protectionExplanation === "string" ? diagnosticData.protectionExplanation : null;

  const organizationName =
  (typeof diagnosticData?.assessment?.organization?.name === "string" && diagnosticData.assessment.organization.name.trim()
    ? diagnosticData.assessment.organization.name.trim()
    : null) ??
  (typeof diagnosticData?.organization?.name === "string" && diagnosticData.organization.name.trim()
    ? diagnosticData.organization.name.trim()
    : null) ??
  (typeof diagnosticData?.organizationName === "string" && diagnosticData.organizationName.trim()
    ? diagnosticData.organizationName.trim()
    : null) ??
  "No org name present";
  const participantsCompleted =
  typeof diagnosticData?.participantsCompleted === "number"
    ? diagnosticData.participantsCompleted
    : typeof diagnosticData?.meta?.participantsCompleted === "number"
      ? diagnosticData.meta.participantsCompleted
      : null;

const participantsTotal =
  typeof diagnosticData?.participantsTotal === "number"
    ? diagnosticData.participantsTotal
    : typeof diagnosticData?.meta?.participantsTotal === "number"
      ? diagnosticData.meta.participantsTotal
      : null;
  return (
    <main
      className={montserrat.className}
      style={{
        minHeight: "100vh",
        background: BRAND.bg,
        padding: 32,
        color: BRAND.text,
      }}
    >
      <style>{`
 /* Hide print-only blocks on screen */
 [data-print-only="true"] {
   display: none !important;
 }

 @media print {
   [data-no-print="true"] {
     display: none !important;
   }

   [data-print-only="true"] {
     display: block !important;
   }

   html, body {
     background: #ffffff !important;
   }

   main {
     padding: 0 !important;
   }

   .print-radar {
     overflow: visible !important;
   }

   .print-radar svg {
     transform: scale(0.84);
     transform-origin: top center;
   }

   .print-section {
     break-inside: avoid;
     page-break-inside: avoid;
   }
 }
`}</style>

      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div className="print-header" data-print-only="true">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: BRAND.dark }}>Northline Intelligence</div>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 900, color: BRAND.dark }}>Executive Insights</div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, color: BRAND.dark }}>{organizationName}</div>

              <div style={{ marginTop: 2, fontSize: 12, fontWeight: 800, color: BRAND.greyBlue }}>
                Assessment: {assessmentId ?? "—"}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: BRAND.greyBlue }}>Version</div>
              <div style={{ marginTop: 4, fontSize: 14, fontWeight: 900, color: BRAND.dark }}>
                v{narrative?.version ?? "—"}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: BRAND.greyBlue }}>
                Generated: {narrative ? isoToPretty(narrative.created_at) : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Masthead */}
<div
  data-no-print="true"
  style={{
    background: BRAND.card,
    border: `1px solid ${BRAND.border}`,
    borderRadius: 20,
    padding: 20,
    boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)",
    position: "sticky",
    top: 16,
    zIndex: 10,
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
    }}
  >
    {/* Left */}
    <div style={{ flex: "1 1 420px", minWidth: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>
          Northline Executive Insights
        </div>

        {/* Org pill */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            background: "#F3F7FF",
            border: `1px solid ${BRAND.border}`,
            color: BRAND.dark,
            fontWeight: 850,
            fontSize: 12,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
          title={organizationName}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: BRAND.cyan,
              display: "inline-block",
            }}
          />
          {organizationName}
        </span>
      </div>

      <div style={{ marginTop: 6, color: BRAND.muted, fontWeight: 650 }}>
        Strategic intelligence layer
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
        <div style={{ color: BRAND.greyBlue, fontSize: 12, fontWeight: 800 }}>
          Assessment
        </div>
        <div
          style={{
            color: BRAND.dark,
            fontSize: 12,
            fontWeight: 800,
            opacity: 0.9,
            wordBreak: "break-all",
          }}
        >
          {assessmentId ?? "—"}
        </div>
      </div>
    </div>

    {/* Right: Actions */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {/* Export PDF */}
      <a
        href={
          assessmentId
            ? `/assessments/${assessmentId}/narrative?${[authQs, "print=1"].filter(Boolean).join("&")}`
            : "#"
        }
        target="_blank"
        rel="noreferrer"
        style={{
          background: "#FFFFFF",
          color: BRAND.dark,
          border: `1px solid ${BRAND.border}`,
          padding: "10px 14px",
          borderRadius: 14,
          fontWeight: 900,
          cursor: "pointer",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 10px 20px rgba(15, 23, 42, 0.06)",
        }}
      >
        Export PDF
      </a>

            {/* Generate / Refresh (admin OR invite-link participant) */}
            <button
        onClick={onGenerate}
        disabled={!canAttemptGenerate || participantLocked || submitting}
        title={
          !canAttemptGenerate
            ? "Requires an invite link (?email=...&token=...) or an admin session."
            : participantLocked
            ? "Waiting for completion."
            : "Generate / Refresh the memo"
        }
        style={{
          background: BRAND.cyan,
          color: BRAND.dark,
          border: `1px solid ${BRAND.border}`,
          padding: "10px 14px",
          borderRadius: 14,
          fontWeight: 950,
          cursor: !canAttemptGenerate || participantLocked || submitting ? "not-allowed" : "pointer",
          opacity: !canAttemptGenerate || participantLocked || submitting ? 0.55 : 1,
          boxShadow: "0 10px 20px rgba(52, 176, 180, 0.18)",
        }}
      >
        {submitting ? "Generating…" : "Generate / Refresh"}
      </button>

      {/* Admin-only: Raw JSON toggle */}
      {showAdminControls ? (
        <button
          type="button"
          onClick={() => setShowRaw((s) => !s)}
          disabled={!narrative}
          style={{
            background: "#FFFFFF",
            color: BRAND.dark,
            border: `1px solid ${BRAND.border}`,
            padding: "10px 14px",
            borderRadius: 14,
            fontWeight: 900,
            cursor: narrative ? "pointer" : "not-allowed",
            opacity: narrative ? 1 : 0.6,
          }}
        >
          {showRaw ? "Hide raw JSON" : "Show raw JSON"}
        </button>
      ) : null}
    </div>
  </div>
</div>
{participantLocked ? (
  <div
    style={{
      marginTop: 12,
      border: "1px solid #FED7D7",
      background: "#FFF5F5",
      borderRadius: 12,
      padding: 12,
      color: BRAND.danger,
      fontWeight: 850,
      lineHeight: 1.35,
      whiteSpace: "pre-line",
    }}
  >
    All participants have not completed the assessment.
    {"\n\n"}
    Please check back once the administrator confirms completion.
    {typeof participantsCompleted === "number" && typeof participantsTotal === "number" ? (
      <>
        {"\n\n"}
        Progress: {participantsCompleted}/{participantsTotal} completed
      </>
    ) : null}
  </div>
) : null}

        {err ? (
          <div
            style={{
              marginTop: 16,
              background: "#FFF5F5",
              border: "1px solid #FED7D7",
              borderRadius: 14,
              padding: 14,
              color: BRAND.danger,
              fontWeight: 800,
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
              fontWeight: 800,
            }}
          >
            Diagnostics warning: {diagnosticErr} {didRetryResults ? "(retried once)" : ""}
          </div>
        ) : null}

        <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
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
                <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 800 }}>Structural Profile</div>
                <div style={{ marginTop: 6, fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
                  Northline Readiness Index & Pillar Balance
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ color: BRAND.muted, fontSize: 12, fontWeight: 800 }}>Readiness Index</div>

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
                  <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>
                    {typeof readinessIndex === "number" ? readinessIndex.toFixed(1) : "—"}
                  </div>

                  {maturity ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: `1px solid ${maturityBadgeStyle(maturity.tier).border}`,
                        background: maturityBadgeStyle(maturity.tier).bg,
                        color: maturityBadgeStyle(maturity.tier).text,
                        fontWeight: 800,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ fontWeight: 900 }}>{maturity.label ?? "Maturity"}</span>
                      {maturity.posture ? <span style={{ opacity: 0.9, fontWeight: 700 }}>• {maturity.posture}</span> : null}
                    </div>
                  ) : null}
                </div>

                {protectionExplanation ? (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => setShowProtectionMethod((s) => !s)}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: BRAND.dark,
                        fontWeight: 800,
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
                          fontWeight: 700,
                          fontSize: 12,
                          lineHeight: 1.4,
                          textAlign: "left",
                        }}
                      >
                        {protectionExplanation}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="print-radar" style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              {diagnosticLoading && !diagnosticData ? (
                <div style={{ color: BRAND.muted, fontWeight: 700 }}>Loading diagnostic structure…</div>
              ) : (
                <RadarChart data={radarData} size={isPrint ? 430 : 520} />
              )}
            </div>

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
                      fontWeight: 700,
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
          </section>

          {/* Executive Memo */}
          <section
            className="print-section"
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 18,
              padding: 22,
              boxShadow: "0 10px 36px rgba(15, 23, 42, 0.06)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 20, fontWeight: 900 }}>Executive Memo</h2>

              <div style={{ color: BRAND.greyBlue, fontSize: 12, fontWeight: 800 }}>Memo-grade insight</div>
            </div>

            <div style={{ marginTop: 10, color: BRAND.muted, fontWeight: 600, lineHeight: 1.5 }}>
              Executive decision-making module.
            </div>

            {(() => {
              const memoText =
                typeof narrativeJson?.maturityInterpretation?.explanation === "string"
                  ? narrativeJson.maturityInterpretation.explanation
                  : "";

              // Split into sections. We DO want High-Value Entry Points + Sequencing here.
              const sections = parseMemoSections(memoText).filter(
                (s) => String(s.title || "").toLowerCase() !== "risk interpretation"
              );

              if (!memoText.trim()) {
                return (
                  <div style={{ marginTop: 14, color: BRAND.muted, fontWeight: 700 }}>
                    No memo text yet (click Generate / Refresh).
                  </div>
                );
              }

              // If the model didn’t include headings, show as one clean block.
              if (sections.length === 0) {
                return (
                  <div
                    style={{
                      marginTop: 16,
                      border: `1px solid ${BRAND.border}`,
                      background: "#F8FAFC",
                      borderRadius: 14,
                      padding: 16,
                      color: BRAND.text,
                      fontWeight: 700,
                      lineHeight: 1.75,
                      whiteSpace: "pre-wrap",
                      fontSize: 15,
                    }}
                  >
                    {memoText}
                  </div>
                );
              }

              return (
                <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
                  {sections.map((s, idx) => (
                    <div
                      key={`${s.title}-${idx}`}
                      style={{
                        border: `1px solid ${BRAND.border}`,
                        borderRadius: 16,
                        background: idx === 0 ? "#FFFFFF" : "#FBFDFF",
                        padding: 16,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {/* subtle left accent */}
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 5,
                          background: BRAND.cyan,
                          opacity: idx === 0 ? 0.95 : 0.65,
                        }}
                      />

                      <div style={{ paddingLeft: 6 }}>
                        <div style={{ color: BRAND.dark, fontSize: 14, fontWeight: 900, letterSpacing: 0.2 }}>
                          {s.title}
                        </div>

                        <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                          {(() => {
                            const isEntryPoints =
                              String(s.title || "").toLowerCase() === "northline high-value entry points";

                            // Default rendering for all other memo sections
                            if (!isEntryPoints) {
                              return s.body.map((p, i) => {
                                const { lead, paras } = chunkTextForExecRead(p);

                                return (
                                  <div key={i} style={{ display: "grid", gap: 10 }}>
                                    {lead ? (
                                      <div
                                        style={{
                                          color: BRAND.text,
                                          fontWeight: 900,
                                          lineHeight: 1.7,
                                          fontSize: 15,
                                        }}
                                      >
                                        {lead}
                                      </div>
                                    ) : null}

                                    {paras.map((pp, j) => (
                                      <div
                                        key={`${i}-${j}`}
                                        style={{
                                          color: BRAND.text,
                                          fontWeight: 700,
                                          lineHeight: 1.75,
                                          fontSize: 14,
                                          opacity: 0.98,
                                        }}
                                      >
                                        {pp}
                                      </div>
                                    ))}
                                  </div>
                                );
                              });
                            }

                            // ENTRY POINTS — group every 3 lines into one project card
                            const projects: Array<{
                              name?: string;
                              outcome?: string;
                              firstMove?: string;
                            }> = [];

                            for (let i = 0; i < s.body.length; i++) {
                              const line = String(s.body[i] ?? "");
                              const match = line.match(/^(Project Name|Outcome|First Move)\s*:\s*(.*)$/i);
                              if (!match) continue;

                              const label = match[1].toLowerCase();
                              const value = match[2] ?? "";

                              if (label === "project name") {
                                projects.push({ name: value });
                              } else if (label === "outcome") {
                                if (projects.length > 0) projects[projects.length - 1].outcome = value;
                              } else if (label === "first move") {
                                if (projects.length > 0) projects[projects.length - 1].firstMove = value;
                              }
                            }

                            return projects.map((proj, idx) => (
                              <div
                                key={idx}
                                style={{
                                  border: `1px solid ${BRAND.border}`,
                                  borderRadius: 16,
                                  background: "#FFFFFF",
                                  padding: 16,
                                  display: "grid",
                                  gap: 12,
                                }}
                              >
                                {/* Project Name */}
                                <div>
                                  <div
                                    style={{
                                      color: BRAND.greyBlue,
                                      fontSize: 12,
                                      fontWeight: 900,
                                      textTransform: "uppercase",
                                      letterSpacing: 0.4,
                                    }}
                                  >
                                    Project Name
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 4,
                                      color: BRAND.text,
                                      fontSize: 16,
                                      fontWeight: 900,
                                      lineHeight: 1.6,
                                    }}
                                  >
                                    {proj.name}
                                  </div>
                                </div>

                                {/* Outcome */}
                                <div>
                                  <div
                                    style={{
                                      color: BRAND.greyBlue,
                                      fontSize: 12,
                                      fontWeight: 900,
                                      textTransform: "uppercase",
                                      letterSpacing: 0.4,
                                    }}
                                  >
                                    Outcome
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 4,
                                      color: BRAND.text,
                                      fontSize: 14,
                                      fontWeight: 900,
                                      lineHeight: 1.7,
                                    }}
                                  >
                                    {proj.outcome}
                                  </div>
                                </div>

                                {/* First Move */}
                                <div>
                                  <div
                                    style={{
                                      color: BRAND.greyBlue,
                                      fontSize: 12,
                                      fontWeight: 900,
                                      textTransform: "uppercase",
                                      letterSpacing: 0.4,
                                    }}
                                  >
                                    First Move
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 4,
                                      color: BRAND.text,
                                      fontSize: 14,
                                      fontWeight: 700,
                                      lineHeight: 1.7,
                                    }}
                                  >
                                    {proj.firstMove}
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 20, fontWeight: 900 }}>Risk Signals</h2>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${BRAND.border}`,
                  background: "#FFFFFF",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: BRAND.greyBlue, letterSpacing: 0.5 }}>
                  SIGNALS DETECTED
                </span>
                <span style={{ fontSize: 22, fontWeight: 900, color: BRAND.dark }}>{riskFlags.length}</span>
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 16,
                background: riskFlags.length > 0 ? "#FFFBEB" : "#F0FDF4",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.greyBlue }}>Summary</div>

                <div style={{ marginTop: 4, fontSize: 16, fontWeight: 900, color: BRAND.dark }}>
                  {riskFlags.length === 0
                    ? "No structural risk signals detected"
                    : `${riskFlags.length} structural risk signal${riskFlags.length === 1 ? "" : "s"} detected`}
                </div>

                {riskFlags.length > 0 ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {riskPillarsFromFlags(riskFlags).map((p) => (
                      <span
                        key={p}
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: "#FFFFFF",
                          border: `1px solid ${BRAND.border}`,
                          color: BRAND.dark,
                        }}
                      >
                        {prettyRiskPillarLabel(p)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.greyBlue }}>Count</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: BRAND.dark }}>{riskFlags.length}</div>
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                border: `1px solid ${BRAND.border}`,
                background: "#F8FAFC",
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.greyBlue }}>Interpretation</div>

              <div style={{ marginTop: 8, color: BRAND.text, fontWeight: 700, lineHeight: 1.7, fontSize: 14 }}>
                {typeof narrativeJson?.risks?.implications === "string" && narrativeJson.risks.implications.trim()
                  ? narrativeJson.risks.implications
                  : riskFlags.length > 0
                    ? "Risk signals were detected, but a narrative interpretation was not provided. Regenerate to refresh the memo."
                    : "No structural triggers were detected under current rules. Continue monitoring for divergence or uneven adoption patterns."}
              </div>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {riskFlags.length === 0 ? (
                <div style={{ color: BRAND.muted, fontWeight: 700 }}>No flags to display.</div>
              ) : (
                riskFlags.map((rf: any, idx: number) => {
                  const st = severityStyle(rf?.severity);
                  const brief = briefForRiskFlag(rf);
                  const key = String(rf?.key ?? rf?.details?.rule ?? `risk-${idx}`);

                  const detailsLine = formatRiskDetails(rf?.details);
                  const cardId = key;
                  const isOpen = !!openEvidence[cardId];

                  return (
                    <div
                      key={key}
                      style={{
                        border: `1px solid ${st.border}`,
                        background: "#FFFFFF",
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
                          <div style={{ fontWeight: 900, color: BRAND.dark, fontSize: 14 }}>{brief.signal}</div>
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
                            fontWeight: 800,
                            color: st.text,
                            fontSize: 12,
                          }}
                        >
                          {st.label}
                        </div>
                      </div>

                      {detailsLine ? (
                        <div style={{ marginTop: 8, color: BRAND.greyBlue, fontWeight: 700, fontSize: 12, lineHeight: 1.4 }}>
                          {detailsLine}
                        </div>
                      ) : null}

                      <div style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={() => setOpenEvidence((prev) => ({ ...prev, [cardId]: !prev[cardId] }))}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: BRAND.greyBlue,
                            fontWeight: 800,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          {isOpen ? "Hide details" : "Show details"}
                        </button>

                        {isOpen ? (
                          <div
                            style={{
                              marginTop: 8,
                              paddingTop: 10,
                              borderTop: `1px dashed ${BRAND.border}`,
                              color: BRAND.text,
                              fontWeight: 700,
                              fontSize: 13,
                              lineHeight: 1.55,
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: 800, color: BRAND.greyBlue }}>Meaning: </span>
                              {brief.meaning}
                            </div>
                            <div>
                              <span style={{ fontWeight: 800, color: BRAND.greyBlue }}>Recommended focus: </span>
                              {brief.focus}
                            </div>
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
            <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 900 }}>Assumptions & Data Gaps</h2>

            <div style={{ marginTop: 12 }}>
              <details
                style={{
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: 14,
                  background: "#F8FAFC",
                  padding: 12,
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    fontWeight: 900,
                    color: BRAND.dark,
                  }}
                >
                  <span>
                    View missing inputs
                    <span style={{ marginLeft: 10, color: BRAND.greyBlue, fontWeight: 800 }}>({missingInputs.length})</span>
                  </span>

                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${BRAND.border}`,
                      background: "#FFFFFF",
                      color: BRAND.greyBlue,
                      fontWeight: 800,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Expand
                  </span>
                </summary>

                {missingInputs.length === 0 ? (
                  <div style={{ marginTop: 10, color: BRAND.muted, fontWeight: 700 }}>None listed (generate first).</div>
                ) : (
                  <ul
                    style={{
                      marginTop: 12,
                      marginBottom: 0,
                      paddingLeft: 18,
                      color: BRAND.text,
                      fontWeight: 700,
                      lineHeight: 1.6,
                    }}
                  >
                    {missingInputs.map((x) => (
                      <li key={x} style={{ marginTop: 6 }}>
                        {x}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </div>
          </section>

          {/* Raw Narrative (optional) */}
          {showAdminControls && showRaw && narrative ? (
            <section
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 8px 30px rgba(15, 23, 42, 0.04)",
              }}
            >
              <h2 style={{ margin: 0, color: BRAND.dark, fontSize: 18, fontWeight: 900 }}>Raw Narrative Artifact</h2>
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
  );
}