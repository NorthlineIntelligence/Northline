"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";
import { ParticipantAnswerSections } from "@/components/assessments/ParticipantAnswerSections";
import type { PriorityAnswerRow, ReadinessAnswerRow } from "@/lib/assessmentParticipantResponses";

type ParticipantPayload = {
  id: string;
  email: string | null;
  role: string | null;
  department: string | null;
  seniority_level: string | null;
  completed_at: string | null;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  assessment?: {
    id: string;
    name: string | null;
    assessmentType: "READINESS" | "PRIORITY_DISCOVERY";
    organizationName: string;
  };
  participant?: ParticipantPayload;
  responses?: Array<ReadinessAnswerRow | PriorityAnswerRow>;
};

export default function ParticipantAnswersPage() {
  const params = useParams<{ id: string; participantId: string }>();
  const assessmentId = params.id;
  const participantId = params.participantId;
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/assessments/${assessmentId}/participants/${participantId}/responses`,
          { credentials: "include" }
        );
        const json = (await res.json()) as ApiResponse;
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load participant answers.");
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load participant answers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId, participantId]);

  return (
    <div className="min-h-screen px-4 py-8 md:px-8" style={{ background: shellBackground }}>
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Participant answers
            </div>
            <h1 className="mt-1 text-2xl font-black" style={{ color: BRAND.dark }}>
              {data?.participant?.email ?? "Participant"}
            </h1>
            <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              {data?.assessment?.organizationName ?? "Organization"} ·{" "}
              {data?.assessment?.assessmentType === "PRIORITY_DISCOVERY" ? "Priority Discovery" : "Readiness"}
            </p>
          </div>
          <Link
            href={`/admin/assessments/${assessmentId}`}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-bold"
            style={{ borderColor: BRAND.border, color: BRAND.dark }}
          >
            ← Back to assessment
          </Link>
        </div>

        {data?.participant ? (
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold" style={{ color: BRAND.dark }}>
            <span>{data.participant.role ?? "Role not set"}</span>
            <span>·</span>
            <span>{data.participant.department ?? "Department not set"}</span>
            <span>·</span>
            <span>{data.participant.seniority_level ?? "Seniority not set"}</span>
            <span>·</span>
            <span>{data.participant.completed_at ? "Completed" : "In progress"}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-8 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Loading answers…
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-2xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: BRAND.danger, color: BRAND.danger }}>
            {error}
          </div>
        ) : null}

        {!loading && !error && (data?.responses?.length ?? 0) === 0 ? (
          <div className="mt-8 rounded-2xl border bg-white/95 p-6 text-sm font-semibold shadow-sm" style={{ borderColor: BRAND.border, color: BRAND.muted }}>
            No answers recorded for this participant yet.
          </div>
        ) : null}

        <div className="mt-8">
          <ParticipantAnswerSections responses={data?.responses ?? []} />
        </div>
      </div>
    </div>
  );
}
