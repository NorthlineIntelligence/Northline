import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { buildAssessmentResultsPayload } from "@/lib/assessmentResultsEngine";

type DeptKey = string;

function pct(n: number) {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n)}%`;
}

function safeDeptLabel(d: string | null) {
  if (!d) return "Unassigned";
  return String(d).replaceAll("_", " ");
}

function fmt1(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toFixed(1);
}

function pillarLabel(p: string) {
  return String(p).replaceAll("_", " ");
}

function scoreBand(score: number | null | undefined) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return { label: "Unknown", color: "#cdd8df" };
  }

  if (score <= 2.4) {
    return { label: "Stabilize First", color: "#66819e" };
  }

  if (score <= 3.4) {
    return { label: "Proceed with Intention", color: "#34b0b4" };
  }

  return { label: "Ready to Scale", color: "#173464" };
}

export default async function AdminAssessmentDashboardPage(props: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<{ weak?: string }>;
}) {
  const admin = await requireAdmin();
  const adminUserId = admin?.user?.id ?? null;

  const { id } = await props.params;
  const assessmentId = id ?? null;
  if (!assessmentId) notFound();

  const sp = (await props.searchParams) ?? {};
  const showWeakOnly = String(sp.weak ?? "") === "1";

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      name: true,
      status: true,
      locked_at: true,
      created_at: true,
      locked_department: true,
      organization: { select: { id: true, name: true } },
      Participant: {
        select: {
          id: true,
          email: true,
          user_id: true,
          department: true,
          invite_sent_at: true,
          invite_accepted_at: true,
          completed_at: true,
          created_at: true,
        },
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!assessment) notFound();

  const participantsAll = assessment.Participant ?? [];
  const participants = adminUserId
    ? participantsAll.filter((p) => p.user_id !== adminUserId)
    : participantsAll;

  const participantsCount = participants.length;

  const invited = participants.filter((p) => (p.email ?? "").trim().length > 0);

  const respondedDistinct = await prisma.response.findMany({
    where: { assessment_id: assessmentId },
    distinct: ["participant_id"],
    select: { participant_id: true },
  });

  const respondedSet = new Set(respondedDistinct.map((r) => r.participant_id));

  const startedSet = new Set<string>();
  for (const p of participants) {
    if (p.invite_accepted_at) startedSet.add(p.id);
    if (respondedSet.has(p.id)) startedSet.add(p.id);
  }

  const completed = participants.filter((p) => p.completed_at != null);

  const invitedCount = invited.length;
  const startedCount = startedSet.size;
  const completedCount = completed.length;

  const completionRate = invitedCount === 0 ? 0 : (completedCount / invitedCount) * 100;

  const deptMap: Record<
    DeptKey,
    {
      dept: string | null;
      invited: number;
      started: number;
      completed: number;
    }
  > = {};

  function ensureDept(d: string | null) {
    const key = d ?? "__UNASSIGNED__";
    if (!deptMap[key]) {
      deptMap[key] = { dept: d, invited: 0, started: 0, completed: 0 };
    }
    return deptMap[key];
  }

  for (const p of participants) {
    const row = ensureDept(p.department ? String(p.department) : null);

    if ((p.email ?? "").trim().length > 0) row.invited += 1;
    if (startedSet.has(p.id)) row.started += 1;
    if (p.completed_at != null) row.completed += 1;
  }

  const deptRows = Object.values(deptMap).sort((a, b) => {
    const al = safeDeptLabel(a.dept).toLowerCase();
    const bl = safeDeptLabel(b.dept).toLowerCase();
    return al.localeCompare(bl);
  });

  const results = await buildAssessmentResultsPayload({ assessmentId });
  const resultsBody = results.ok ? results.body : null;

  const overallNode = resultsBody?.aggregate?.overall;
  const overallScore =
    typeof overallNode === "number"
      ? overallNode
      : overallNode && typeof overallNode === "object"
        ? (overallNode as { weightedAverage?: number | null }).weightedAverage ?? null
        : null;
  const overallBand = scoreBand(overallScore);

  const pillarRows = resultsBody?.aggregate?.pillars
    ? Object.entries(resultsBody.aggregate.pillars).map(([pillarKey, pillarObj]) => {
        const score = pillarObj?.weightedAverage ?? null;
        const band = scoreBand(score);

        return {
          key: pillarKey,
          score,
          band: band.label,
          color: band.color,
        };
      })
    : [];

  const grouped = await prisma.response.groupBy({
    by: ["question_id"],
    where: { assessment_id: assessmentId },
    _avg: { score: true },
    _count: { _all: true },
  });

  const questionIds = grouped.map((g) => g.question_id);

  const questions = questionIds.length
    ? await prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: {
          id: true,
          pillar: true,
          question_text: true,
          display_order: true,
          audience: true,
        },
      })
    : [];

  const qById = new Map(
    questions.map((q) => [
      q.id,
      {
        id: q.id,
        pillar: String(q.pillar),
        question_text: q.question_text,
        display_order: q.display_order,
        audience: String(q.audience),
      },
    ])
  );

  const pillarOrder = [
    "SYSTEM_INTEGRITY",
    "HUMAN_ALIGNMENT",
    "STRATEGIC_COHERENCE",
    "SUSTAINABILITY_PRACTICE",
  ];

  const heatmapRows = grouped
    .map((g) => {
      const q = qById.get(g.question_id);
      const avg = typeof g._avg.score === "number" ? g._avg.score : null;
      const count = Number(g._count._all ?? 0);
      const coverage = participantsCount === 0 ? 0 : (count / participantsCount) * 100;

      return {
        question_id: g.question_id,
        pillar: q?.pillar ?? "UNKNOWN",
        display_order: q?.display_order ?? 9999,
        question_text: q?.question_text ?? "(question text unavailable)",
        audience: q?.audience ?? "UNKNOWN",
        avgScore: avg,
        count,
        coveragePct: coverage,
      };
    })
    .sort((a, b) => {
      const ap = pillarOrder.indexOf(a.pillar);
      const bp = pillarOrder.indexOf(b.pillar);
      const aIdx = ap === -1 ? 999 : ap;
      const bIdx = bp === -1 ? 999 : bp;
      if (aIdx !== bIdx) return aIdx - bIdx;
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.audience.localeCompare(b.audience);
    });

  const displayedHeatmapRows = showWeakOnly
    ? heatmapRows.filter((r) => typeof r.avgScore === "number" && r.avgScore < 3.0)
    : heatmapRows;

  return (
    <div className="min-h-screen bg-[#fcfcfe] text-[#173464]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-[#66819e]">Admin • Assessment Dashboard</div>
            <h1 className="mt-1 text-2xl font-semibold">
              {assessment.organization?.name ?? "Organization"} • {assessment.name ?? "Assessment"}
            </h1>
            <div className="mt-2 text-sm text-[#66819e]">
              Status: <span className="font-semibold text-[#173464]">{String(assessment.status)}</span>
              {assessment.locked_at ? (
                <span className="ml-3">
                  Locked at:{" "}
                  <span className="font-semibold text-[#173464]">
                    {new Date(assessment.locked_at).toLocaleString()}
                  </span>
                </span>
              ) : null}
              {assessment.locked_department ? (
                <span className="ml-3">
                  Locked department:{" "}
                  <span className="font-semibold text-[#173464]">
                    {safeDeptLabel(String(assessment.locked_department))}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/admin/dashboard"
              className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
            >
              Admin Dashboard →
            </a>

            <a
              href={`/admin/assessments/${assessment.id}`}
              className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
            >
              Manage Assessment →
            </a>

            <a
              href={`/assessments/${assessment.id}/narrative`}
              className="rounded-lg bg-[#173464] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
            >
              Executive Insights →
            </a>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card title="Invited" value={String(invitedCount)} sub="Participants with email" />
          <Card title="Started" value={String(startedCount)} sub="Accepted invite or answered" />
          <Card title="Completed" value={String(completedCount)} sub="Completed_at set" />
          <Card title="Completion Rate" value={pct(completionRate)} sub="Completed / Invited" />
        </div>

        <div className="mt-6 rounded-2xl border border-[#e6eaf2] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Participation Funnel</div>
              <div className="mt-1 text-sm text-[#66819e]">
                Quick view of dropoff from invite → start → completion.
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 items-stretch gap-3 md:grid-cols-7">
            <div className="rounded-2xl border border-[#e6eaf2] bg-[#fcfcfe] p-5 md:col-span-2">
              <div className="text-xs font-semibold text-[#66819e]">Invited</div>
              <div className="mt-1 text-3xl font-semibold text-[#173464]">{invitedCount}</div>
              <div className="mt-2 text-xs text-[#66819e]">Has email on participant</div>
            </div>

            <div className="hidden items-center justify-center text-2xl text-[#66819e] md:flex">→</div>

            <div className="rounded-2xl border border-[#e6eaf2] bg-[#fcfcfe] p-5 md:col-span-2">
              <div className="text-xs font-semibold text-[#66819e]">Started</div>
              <div className="mt-1 text-3xl font-semibold text-[#173464]">{startedCount}</div>
              <div className="mt-2 text-xs text-[#66819e]">Accepted invite or answered</div>
            </div>

            <div className="hidden items-center justify-center text-2xl text-[#66819e] md:flex">→</div>

            <div className="rounded-2xl border border-[#e6eaf2] bg-[#fcfcfe] p-5 md:col-span-2">
              <div className="text-xs font-semibold text-[#66819e]">Completed</div>
              <div className="mt-1 text-3xl font-semibold text-[#173464]">{completedCount}</div>
              <div className="mt-2 text-xs text-[#66819e]">Completed_at is set</div>
            </div>
          </div>

          <div className="mt-4 text-xs text-[#66819e]">
            Started rate:{" "}
            <span className="font-semibold text-[#173464]">
              {pct(invitedCount === 0 ? 0 : (startedCount / invitedCount) * 100)}
            </span>
            <span className="mx-2">•</span>
            Completion rate:{" "}
            <span className="font-semibold text-[#173464]">
              {pct(invitedCount === 0 ? 0 : (completedCount / invitedCount) * 100)}
            </span>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-[#e6eaf2] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Results Snapshot</div>
              <div className="mt-1 text-sm text-[#66819e]">
                Uses the same scoring engine as Executive Insights (no drift).
              </div>
            </div>

            <a
              href={`/assessments/${assessment.id}/results`}
              className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
            >
              View Results Page →
            </a>
          </div>

          {!resultsBody ? (
            <div className="mt-4 text-sm text-[#66819e]">
              Results not available yet (or scoring engine returned an error).
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-[#e6eaf2] bg-[#fcfcfe] p-5">
                <div className="text-xs font-semibold text-[#66819e]">Overall Score</div>
                <div className="mt-1 text-3xl font-semibold text-[#173464]">
                  {fmt1(overallScore)}
                </div>
                <div
                  className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ backgroundColor: "#f6f8fc", border: "1px solid #e6eaf2" }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: overallBand.color,
                      display: "inline-block",
                    }}
                  />
                  <span className="text-[#173464]">{overallBand.label}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e6eaf2] bg-[#fcfcfe] p-5 md:col-span-2">
                <div className="text-xs font-semibold text-[#66819e]">Pillar Scores</div>

                <div className="mt-3 overflow-auto rounded-xl border border-[#e6eaf2] bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#f6f8fc]">
                      <tr>
                        <th className="px-4 py-3 text-left">Pillar</th>
                        <th className="px-4 py-3 text-left">Score</th>
                        <th className="px-4 py-3 text-left">Band</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pillarRows.map((r) => (
                        <tr key={r.key} className="border-t border-[#e6eaf2]">
                          <td className="px-4 py-3 font-semibold">{pillarLabel(String(r.key))}</td>
                          <td className="px-4 py-3">{fmt1(r.score)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2">
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 999,
                                  backgroundColor: r.color,
                                  display: "inline-block",
                                }}
                              />
                              <span>{r.band}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 text-xs text-[#66819e]">
                  These bands are derived directly from the pillar scores.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-[#e6eaf2] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Question Heatmap</div>
              <div className="mt-1 text-sm text-[#66819e]">
                Sorts by pillar, then display order. Helps you pinpoint weak spots.
              </div>
            </div>

            <div className="text-xs text-[#66819e]">
              Coverage is responses ÷ total participants ({participantsCount}).
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[#66819e]">
              Showing:{" "}
              <span className="font-semibold text-[#173464]">
                {showWeakOnly ? "Weak only (avg &lt; 3.0)" : "All questions"}
              </span>
              <span className="mx-2">•</span>
              Rows:{" "}
              <span className="font-semibold text-[#173464]">{displayedHeatmapRows.length}</span>
            </div>

            <div className="flex items-center gap-2">
              {showWeakOnly ? (
                <a
                  href={`/admin/assessments/${assessment.id}/dashboard`}
                  className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
                >
                  Show all
                </a>
              ) : (
                <a
                  href={`/admin/assessments/${assessment.id}/dashboard?weak=1`}
                  className="rounded-lg bg-[#173464] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
                >
                  Show weak only
                </a>
              )}
            </div>
          </div>

          {displayedHeatmapRows.length === 0 ? (
            <div className="mt-4 text-sm text-[#66819e]">
              {heatmapRows.length === 0 ? "No responses yet." : "No weak questions under 3.0."}
            </div>
          ) : (
            <div className="mt-4 overflow-auto rounded-xl border border-[#e6eaf2]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f6f8fc]">
                  <tr>
                    <th className="px-4 py-3 text-left">Pillar</th>
                    <th className="px-4 py-3 text-left">Question</th>
                    <th className="px-4 py-3 text-left">Audience</th>
                    <th className="px-4 py-3 text-left">Avg Score</th>
                    <th className="px-4 py-3 text-left">Responses</th>
                    <th className="px-4 py-3 text-left">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedHeatmapRows.map((r) => (
                    <tr key={r.question_id} className="border-t border-[#e6eaf2]">
                      <td className="px-4 py-3 font-semibold">{pillarLabel(r.pillar)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#173464]">{r.question_text}</div>
                        <div className="text-xs text-[#66819e]">Order {r.display_order}</div>
                      </td>
                      <td className="px-4 py-3">{safeDeptLabel(r.audience)}</td>
                      <td className="px-4 py-3">{fmt1(r.avgScore)}</td>
                      <td className="px-4 py-3">{r.count}</td>
                      <td className="px-4 py-3">{pct(r.coveragePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 text-xs text-[#66819e]">
            Interpretation tip: low average + high coverage = real weakness. Low average + low coverage = needs more completions.
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-[#e6eaf2] bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Department Breakdown</div>
              <div className="mt-1 text-sm text-[#66819e]">This helps you see which teams are lagging.</div>
            </div>

            <div className="text-xs text-[#66819e]">
              Assessment ID: <span className="font-mono">{assessment.id}</span>
            </div>
          </div>

          {deptRows.length === 0 ? (
            <div className="mt-4 text-sm text-[#66819e]">No participants yet.</div>
          ) : (
            <div className="mt-4 overflow-auto rounded-xl border border-[#e6eaf2]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f6f8fc]">
                  <tr>
                    <th className="px-4 py-3 text-left">Department</th>
                    <th className="px-4 py-3 text-left">Invited</th>
                    <th className="px-4 py-3 text-left">Started</th>
                    <th className="px-4 py-3 text-left">Completed</th>
                    <th className="px-4 py-3 text-left">Completion Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {deptRows.map((r) => {
                    const rate = r.invited === 0 ? 0 : (r.completed / r.invited) * 100;
                    return (
                      <tr key={r.dept ?? "__UNASSIGNED__"} className="border-t border-[#e6eaf2]">
                        <td className="px-4 py-3 font-semibold">{safeDeptLabel(r.dept)}</td>
                        <td className="px-4 py-3">{r.invited}</td>
                        <td className="px-4 py-3">{r.started}</td>
                        <td className="px-4 py-3">{r.completed}</td>
                        <td className="px-4 py-3">{pct(rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-[#e6eaf2] bg-white p-4 text-xs text-[#66819e]">
          Tip: “Started” counts anyone who accepted the invite or answered at least one question. This is the best early signal for participation momentum.
        </div>
      </div>
    </div>
  );
}

function Card(props: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-[#e6eaf2] bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold text-[#66819e]">{props.title}</div>
      <div className="mt-1 text-2xl font-semibold text-[#173464]">{props.value}</div>
      <div className="mt-1 text-xs text-[#66819e]">{props.sub}</div>
    </div>
  );
}