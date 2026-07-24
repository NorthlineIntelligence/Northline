"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";
import { ParticipantAnswerSections } from "@/components/assessments/ParticipantAnswerSections";
import type { PriorityAnswerRow, ReadinessAnswerRow } from "@/lib/assessmentParticipantResponses";

type ParticipantBlock = {
  participant: {
    id: string;
    email: string | null;
    role: string | null;
    department: string | null;
    seniority_level: string | null;
    completed_at: string | null;
  };
  responses: Array<ReadinessAnswerRow | PriorityAnswerRow>;
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
  participants?: ParticipantBlock[];
};

export default function AllParticipantAnswersPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const assessmentId = params.id;
  const returnTo = searchParams.get("returnTo");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const backHref =
    returnTo === "client-readout"
      ? `/admin/assessments/${assessmentId}/priority-client-readout`
      : `/admin/assessments/${assessmentId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/assessments/${assessmentId}/participant-answers`, {
          credentials: "include",
        });
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
  }, [assessmentId]);

  return (
    <div className="min-h-screen px-4 py-8 md:px-8" style={{ background: shellBackground }}>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              All participant answers
            </div>
            <h1 className="mt-1 text-2xl font-black" style={{ color: BRAND.dark }}>
              {data?.assessment?.organizationName ?? "Assessment"} responses
            </h1>
            <p className="mt-2 text-sm font-semibold" style={{ color: BRAND.muted }}>
              {data?.assessment?.assessmentType === "PRIORITY_DISCOVERY" ? "Priority Discovery" : "Readiness"} ·{" "}
              {data?.participants?.length ?? 0} participants
            </p>
          </div>
          <Link
            href={backHref}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-bold"
            style={{ borderColor: BRAND.border, color: BRAND.dark }}
          >
            ← Back
          </Link>
        </div>

        {loading ? (
          <div className="mt-8 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Loading answers…
          </div>
        ) : null}

        {error ? (
          <div
            className="mt-8 rounded-2xl border px-4 py-3 text-sm font-semibold"
            style={{ borderColor: BRAND.danger, color: BRAND.danger }}
          >
            {error}
          </div>
        ) : null}

        {!loading && !error && (data?.participants?.length ?? 0) === 0 ? (
          <div
            className="mt-8 rounded-2xl border bg-white/95 p-6 text-sm font-semibold shadow-sm"
            style={{ borderColor: BRAND.border, color: BRAND.muted }}
          >
            No participants or answers found for this assessment.
          </div>
        ) : null}

        <div className="mt-8 space-y-8">
          {(data?.participants ?? []).map(({ participant, responses }) => (
            <section
              key={participant.id}
              className="rounded-2xl border bg-white/95 p-6 shadow-sm"
              style={{ borderColor: BRAND.border }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black" style={{ color: BRAND.dark }}>
                    {participant.email ?? "Participant"}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold" style={{ color: BRAND.muted }}>
                    <span>{participant.role ?? "Role not set"}</span>
                    <span>·</span>
                    <span>{participant.department ?? "Department not set"}</span>
                    <span>·</span>
                    <span>{participant.seniority_level ?? "Seniority not set"}</span>
                    <span>·</span>
                    <span>{participant.completed_at ? "Completed" : "In progress"}</span>
                  </div>
                </div>
                <Link
                  href={`/admin/assessments/${assessmentId}/participants/${participant.id}/answers`}
                  className="rounded-lg border px-3 py-2 text-xs font-bold"
                  style={{ borderColor: BRAND.border, color: BRAND.dark, background: "#F9FAFB" }}
                >
                  Open individual view →
                </Link>
              </div>
              <div className="mt-6">
                <ParticipantAnswerSections responses={responses} />
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
