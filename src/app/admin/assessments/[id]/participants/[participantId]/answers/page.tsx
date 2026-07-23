"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

type ParticipantPayload = {
  id: string;
  email: string | null;
  role: string | null;
  department: string | null;
  seniority_level: string | null;
  completed_at: string | null;
};

type ReadinessResponse = {
  id: string;
  pillar: string;
  questionText: string;
  questionCore: string | null;
  displayOrder: number;
  score: number;
  freeWrite: string | null;
};

type PriorityResponse = {
  id: string;
  section: string;
  questionText: string;
  questionHelpText: string | null;
  responseType: string;
  order: number;
  answer: string;
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
  responses?: Array<ReadinessResponse | PriorityResponse>;
};

function isPriorityResponse(response: ReadinessResponse | PriorityResponse): response is PriorityResponse {
  return "section" in response;
}

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

  const groupedResponses = useMemo(() => {
    const responses = data?.responses ?? [];
    const groups = new Map<string, Array<ReadinessResponse | PriorityResponse>>();
    for (const response of responses) {
      const key = isPriorityResponse(response) ? response.section : response.pillar;
      const bucket = groups.get(key) ?? [];
      bucket.push(response);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries());
  }, [data?.responses]);

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

        {!loading && !error && groupedResponses.length === 0 ? (
          <div className="mt-8 rounded-2xl border bg-white/95 p-6 text-sm font-semibold shadow-sm" style={{ borderColor: BRAND.border, color: BRAND.muted }}>
            No answers recorded for this participant yet.
          </div>
        ) : null}

        <div className="mt-8 space-y-6">
          {groupedResponses.map(([groupName, responses]) => (
            <section
              key={groupName}
              className="rounded-2xl border bg-white/95 p-6 shadow-sm"
              style={{ borderColor: BRAND.border }}
            >
              <h2 className="text-lg font-black" style={{ color: BRAND.dark }}>
                {groupName}
              </h2>
              <div className="mt-4 space-y-4">
                {responses.map((response) =>
                  isPriorityResponse(response) ? (
                    <div key={response.id} className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                      <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                        {response.responseType}
                      </div>
                      <div className="mt-1 font-semibold" style={{ color: BRAND.dark }}>
                        {response.questionText}
                      </div>
                      {response.questionHelpText ? (
                        <div className="mt-1 text-xs font-semibold" style={{ color: BRAND.muted }}>
                          {response.questionHelpText}
                        </div>
                      ) : null}
                      <div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6" style={{ color: BRAND.dark }}>
                        {response.answer || "—"}
                      </div>
                    </div>
                  ) : (
                    <div key={response.id} className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                      <div className="font-semibold" style={{ color: BRAND.dark }}>
                        {response.questionText}
                      </div>
                      <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.dark }}>
                        Score: {response.score}
                      </div>
                      {response.freeWrite ? (
                        <div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6" style={{ color: BRAND.dark }}>
                          {response.freeWrite}
                        </div>
                      ) : null}
                    </div>
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
