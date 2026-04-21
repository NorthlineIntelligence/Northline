"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CrmQuote, PmProject, PmSprint, PmSprintStatus } from "@prisma/client";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBg } from "@/lib/northlineBrand";

type PmProjectWithSprints = PmProject & {
  sprints: Array<PmSprint & { updates: Array<{ id: string; status_label: string; why_text: string | null; created_at: string }> }>;
};

type ApiResponse = {
  projects: PmProjectWithSprints[];
  quotes: Array<Pick<CrmQuote, "id" | "status" | "total_cents" | "updated_at">>;
};

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function CrmProjectsClient({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectQuoteId, setNewProjectQuoteId] = useState("");
  const [statusLabel, setStatusLabel] = useState("On track");
  const [statusWhy, setStatusWhy] = useState("");
  const [customerVisible, setCustomerVisible] = useState(false);
  const [creatingDuplicate, setCreatingDuplicate] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/crm/organizations/${organizationId}/projects`, { credentials: "include" });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || "Failed to load PM workspace");
    setData(json as ApiResponse);
  }, [organizationId]);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load PM workspace"));
  }, [load]);

  useEffect(() => {
    if (!data?.projects.length) {
      setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId || !data.projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(data.projects[0].id);
    }
  }, [data, selectedProjectId]);

  const project = useMemo(
    () => data?.projects.find((p) => p.id === selectedProjectId) ?? null,
    [data, selectedProjectId]
  );

  async function createProject() {
    if (!newProjectQuoteId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id: newProjectQuoteId,
          allow_duplicate_quote_project: creatingDuplicate,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) {
          setCreatingDuplicate(true);
          throw new Error(
            json?.error ||
              "A project already exists for this quote. Click bootstrap again if you want a second project."
          );
        }
        throw new Error(json?.error || "Create project failed");
      }
      setCreatingDuplicate(false);
      await load();
      setSelectedProjectId(json.project?.id ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Create project failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchSprint(sprintId: string, patch: Record<string, unknown>) {
    if (!project) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/projects/${project.id}/sprints/${sprintId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Sprint update failed");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sprint update failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateAiSummary() {
    if (!project) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/projects/${project.id}/summary/generate`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "AI summary failed");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "AI summary failed");
    } finally {
      setBusy(false);
    }
  }

  async function postUpdate(sprintId: string) {
    if (!project) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/projects/${project.id}/updates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sprint_id: sprintId,
          status_label: statusLabel,
          why_text: statusWhy || undefined,
          is_customer_visible: customerVisible,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Status update failed");
      setStatusWhy("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link href={`/admin/crm/organizations/${organizationId}`} className="text-xs font-black uppercase tracking-wider hover:underline" style={{ color: BRAND.cyan }}>
              ← Back to customer
            </Link>
            <h1 className="mt-2 text-2xl font-black tracking-tight" style={{ color: BRAND.dark }}>
              PM Workspace
            </h1>
            <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Track delivery by sprint, capture status updates, and generate an anonymized AI overview.
            </p>
          </div>
        </header>

        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}

        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Create project from quote
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Starts with quote scope and creates a sprint plan you can edit.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={newProjectQuoteId}
              onChange={(e) => setNewProjectQuoteId(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm font-semibold"
              style={{ borderColor: BRAND.border }}
            >
              <option value="">Select quote</option>
              {data?.quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.status} · {fmtMoney(q.total_cents)} · {new Date(q.updated_at).toLocaleDateString()}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={createProject}
              disabled={busy || !newProjectQuoteId}
              className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              style={{ background: BRAND.dark }}
            >
              {creatingDuplicate ? "Confirm duplicate project" : "Bootstrap project"}
            </button>
          </div>
          {creatingDuplicate ? (
            <p className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
              Duplicate mode enabled for this quote. Click again only if you truly want two projects from one quote.
            </p>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Projects
            </div>
            <div className="mt-2 space-y-2">
              {data?.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  className="w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold"
                  style={{
                    borderColor: p.id === selectedProjectId ? BRAND.dark : BRAND.border,
                    background: p.id === selectedProjectId ? "rgba(23,52,100,0.06)" : "#fff",
                  }}
                >
                  <div>{p.title}</div>
                  <div className="text-xs" style={{ color: BRAND.muted }}>
                    {p.status} · {p.completion_pct}%
                  </div>
                </button>
              ))}
              {!data?.projects.length ? <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>No projects yet.</div> : null}
            </div>
          </aside>

          <main className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            {!project ? (
              <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                Select a project to manage sprints.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-black" style={{ color: BRAND.dark }}>{project.title}</h2>
                    <p className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                      {project.status} · {project.completion_pct}% complete
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={generateAiSummary}
                    disabled={busy}
                    className="rounded-xl px-3 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                    style={{ background: BRAND.cyan }}
                  >
                    Generate AI status overview
                  </button>
                </div>
                <p className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                  AI summary uses OpenAI and automatically scrubs organization naming before save.
                </p>

                {project.last_ai_summary ? (
                  <div className="rounded-xl border px-3 py-3 text-sm font-semibold whitespace-pre-wrap" style={{ borderColor: BRAND.border, background: "rgba(52,176,180,0.06)" }}>
                    {project.last_ai_summary}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {project.sprints.map((s) => (
                    <div key={s.id} className="rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-black" style={{ color: BRAND.dark }}>
                          Sprint {s.sprint_number}: {s.title}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={s.status}
                            onChange={(e) => patchSprint(s.id, { status: e.target.value as PmSprintStatus })}
                            className="rounded border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: BRAND.border }}
                          >
                            {["NOT_STARTED", "ON_TIME", "DELAYED", "OVERDUE", "COMPLETED"].map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={s.completion_pct}
                            onChange={(e) => patchSprint(s.id, { completion_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                            className="w-16 rounded border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: BRAND.border }}
                          />
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full rounded bg-slate-100">
                        <div className="h-2 rounded" style={{ width: `${s.completion_pct}%`, background: BRAND.cyan }} />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          value={statusLabel}
                          onChange={(e) => setStatusLabel(e.target.value)}
                          className="rounded border px-2 py-1 text-xs font-semibold"
                          style={{ borderColor: BRAND.border }}
                          placeholder="Status label (e.g., On track)"
                        />
                        <label className="inline-flex items-center gap-1 text-xs font-semibold">
                          <input type="checkbox" checked={customerVisible} onChange={(e) => setCustomerVisible(e.target.checked)} />
                          Customer visible
                        </label>
                      </div>
                      <textarea
                        value={statusWhy}
                        onChange={(e) => setStatusWhy(e.target.value)}
                        className="mt-2 w-full rounded border px-2 py-1 text-xs font-semibold"
                        style={{ borderColor: BRAND.border }}
                        rows={2}
                        placeholder="Why this status / blockers"
                      />
                      <button
                        type="button"
                        onClick={() => postUpdate(s.id)}
                        disabled={busy || !statusLabel.trim()}
                        className="mt-2 rounded-lg border px-2 py-1 text-xs font-black uppercase disabled:opacity-50"
                        style={{ borderColor: BRAND.border }}
                      >
                        Save status update
                      </button>
                      {s.updates.length > 0 ? (
                        <div className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
                          Latest: {s.updates[0].status_label} {s.updates[0].why_text ? `— ${s.updates[0].why_text}` : ""}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </section>
      </div>
    </div>
  );
}

