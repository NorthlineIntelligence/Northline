"use client";

import { useMemo, useState } from "react";

const MIN_ROWS = 5;
const MAX_ROWS = 25;

type Row = { email: string; canViewExecutiveInsights: boolean };

export default function ParticipantRowsInput() {
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: MIN_ROWS }).map(() => ({ email: "", canViewExecutiveInsights: true }))
  );

  const canAdd = rows.length < MAX_ROWS;
  const filledCount = useMemo(() => rows.filter((r) => r.email.trim()).length, [rows]);

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-[#e6ebf0] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <input
            name="participant_email"
            type="email"
            value={row.email}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r, idx) => (idx === i ? { ...r, email: e.target.value } : r))
              )
            }
            placeholder={`person ${i + 1}@company.com`}
            className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#173464]">
            <input
              type="hidden"
              name="participant_can_view_executive_insights"
              value={row.canViewExecutiveInsights ? "1" : "0"}
            />
            <input
              type="checkbox"
              checked={row.canViewExecutiveInsights}
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r, idx) =>
                    idx === i ? { ...r, canViewExecutiveInsights: e.target.checked } : r
                  )
                )
              }
            />
            Can view Executive Insights
          </label>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[#66819e]">
          {filledCount} participant email(s) entered • showing {rows.length} row(s)
        </div>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() =>
            setRows((prev) => [...prev, { email: "", canViewExecutiveInsights: true }])
          }
          className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-xs font-semibold text-[#173464] disabled:opacity-50"
        >
          Add participant row
        </button>
      </div>
    </div>
  );
}

