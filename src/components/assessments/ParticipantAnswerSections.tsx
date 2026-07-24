"use client";

import type { PriorityAnswerRow, ReadinessAnswerRow } from "@/lib/assessmentParticipantResponses";
import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";

type AnswerRow = ReadinessAnswerRow | PriorityAnswerRow;

function isPriorityResponse(response: AnswerRow): response is PriorityAnswerRow {
  return "section" in response;
}

function groupResponses(responses: AnswerRow[]) {
  const groups = new Map<string, AnswerRow[]>();
  for (const response of responses) {
    const key = isPriorityResponse(response) ? response.section : response.pillar;
    const bucket = groups.get(key) ?? [];
    bucket.push(response);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries());
}

export function ParticipantAnswerSections({ responses }: { responses: AnswerRow[] }) {
  const groupedResponses = groupResponses(responses);

  if (groupedResponses.length === 0) {
    return (
      <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
        No answers recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupedResponses.map(([groupName, groupResponses]) => (
        <section key={groupName}>
          <h3 className="text-base font-black" style={{ color: BRAND.dark }}>
            {groupName}
          </h3>
          <div className="mt-4 space-y-4">
            {groupResponses.map((response) =>
              isPriorityResponse(response) ? (
                <div
                  key={response.id}
                  className="rounded-xl border p-4"
                  style={{ borderColor: BRAND.border, background: "#F9FAFB" }}
                >
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
                  <div
                    className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6"
                    style={{ color: BRAND.dark }}
                  >
                    {response.answer || "—"}
                  </div>
                </div>
              ) : (
                <div
                  key={response.id}
                  className="rounded-xl border p-4"
                  style={{ borderColor: BRAND.border, background: "#F9FAFB" }}
                >
                  <div className="font-semibold" style={{ color: BRAND.dark }}>
                    {response.questionText}
                  </div>
                  <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.dark }}>
                    Score: {response.score}
                  </div>
                  {response.freeWrite ? (
                    <div
                      className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6"
                      style={{ color: BRAND.dark }}
                    >
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
  );
}
