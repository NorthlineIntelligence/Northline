"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CrmQuote, PmProject, PmSprint, PmSprintStatus } from "@prisma/client";
import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";
import { parseWhyWithTransition } from "@/lib/pmStatusAudit";
import { ActionRail, AdminShell, MetricChip, StatusBadge, adminPremiumActionStyle } from "@/lib/adminUiPrimitives";

type PmProjectWithSprints = PmProject & {
  sprints: Array<
    PmSprint & {
      updates: Array<{
        id: string;
        status_label: string;
        why_text: string | null;
        created_at: string;
        author_email?: string | null;
        is_customer_visible?: boolean;
      }>;
    }
  >;
};

type ApiResponse = {
  organization: { id: string; name: string };
  projects: PmProjectWithSprints[];
  quotes: Array<Pick<CrmQuote, "id" | "status" | "total_cents" | "updated_at"> & { active_for_pm?: boolean }>;
};

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatProjectDisplayTitle(raw: string | null | undefined, fallback = "Project") {
  const value = String(raw ?? "").trim();
  if (!value) return fallback;

  // Remove common quote/mail-style prefixes that leak into generated titles.
  const withoutPrefixes = value
    .replace(/^to:\s*/i, "")
    .replace(/\s+from:\s+/i, " — ")
    .replace(/\s+subject:\s+/i, " — ");

  const primary = withoutPrefixes
    .split(/\s+—\s+/)
    .map((s) => s.trim())
    .find(Boolean);

  return (primary || withoutPrefixes || fallback).slice(0, 120);
}

function formatWorkspaceProjectTitle(args: {
  raw: string | null | undefined;
  fallback: string;
  organizationName: string;
  ordinal: number;
}) {
  const cleaned = formatProjectDisplayTitle(args.raw, args.fallback);
  if (/executive leadership/i.test(cleaned)) {
    return `${args.organizationName} Project ${args.ordinal}`;
  }
  return cleaned;
}

function parseScopeSummarySections(raw: string | null | undefined) {
  const text = String(raw ?? "").trim();
  if (!text) return { scopeSummary: "", deliverables: "", projectedTools: "" };

  const sections = {
    scopeSummary: "",
    deliverables: "",
    projectedTools: "",
  };

  const lines = text.split("\n");
  let mode: "scopeSummary" | "deliverables" | "projectedTools" = "scopeSummary";
  const acc = {
    scopeSummary: [] as string[],
    deliverables: [] as string[],
    projectedTools: [] as string[],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^scope summary\s*:/i.test(trimmed)) {
      mode = "scopeSummary";
      const rest = trimmed.replace(/^scope summary\s*:/i, "").trim();
      if (rest) acc.scopeSummary.push(rest);
      continue;
    }
    if (/^what we will deliver\s*:/i.test(trimmed) || /^deliverables\s*:/i.test(trimmed)) {
      mode = "deliverables";
      const rest = trimmed.replace(/^what we will deliver\s*:/i, "").replace(/^deliverables\s*:/i, "").trim();
      if (rest) acc.deliverables.push(rest.replace(/^-+\s*/, ""));
      continue;
    }
    if (/^projected tools\s*:/i.test(trimmed) || /^tools\s*:/i.test(trimmed)) {
      mode = "projectedTools";
      const rest = trimmed.replace(/^projected tools\s*:/i, "").replace(/^tools\s*:/i, "").trim();
      if (rest) acc.projectedTools.push(rest.replace(/^-+\s*/, ""));
      continue;
    }
    if (!trimmed) {
      acc[mode].push("");
      continue;
    }
    if (mode === "deliverables" || mode === "projectedTools") {
      acc[mode].push(trimmed.replace(/^[-*]\s*/, ""));
    } else {
      acc[mode].push(line);
    }
  }

  sections.scopeSummary = acc.scopeSummary.join("\n").trim();
  sections.deliverables = acc.deliverables.join("\n").trim();
  sections.projectedTools = acc.projectedTools.join("\n").trim();
  return sections;
}

function composeScopeSummarySections(args: {
  scopeSummary: string;
  deliverables: string;
  projectedTools: string;
}) {
  const sections: string[] = [];
  if (args.scopeSummary.trim()) sections.push(`Scope Summary:\n${args.scopeSummary.trim()}`);
  if (args.deliverables.trim()) {
    const bullets = args.deliverables
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line}`);
    sections.push(`What we will deliver:\n${bullets.join("\n")}`);
  }
  if (args.projectedTools.trim()) {
    const bullets = args.projectedTools
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line}`);
    sections.push(`Projected Tools:\n${bullets.join("\n")}`);
  }
  return sections.join("\n\n").trim();
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
  const [createProjectMode, setCreateProjectMode] = useState<"new" | "existing">("new");
  const [existingProjectTargetId, setExistingProjectTargetId] = useState("");
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"list" | "board" | "timeline">("list");
  const [projectWindowStartDate, setProjectWindowStartDate] = useState("");
  const [projectWindowEndDate, setProjectWindowEndDate] = useState("");
  const [lockedScopeIds, setLockedScopeIds] = useState<Record<string, boolean>>({});
  const selectionStorageKey = `pm:selected-project:${organizationId}`;
  const scopeLockStorageKey = `pm:scope-locks:${organizationId}`;

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
    try {
      const saved = window.localStorage.getItem(selectionStorageKey);
      if (saved) setSelectedProjectId(saved);
      const savedLocks = window.localStorage.getItem(scopeLockStorageKey);
      if (savedLocks) setLockedScopeIds(JSON.parse(savedLocks) as Record<string, boolean>);
    } catch {
      // Ignore storage errors.
    }
  }, [selectionStorageKey, scopeLockStorageKey]);

  useEffect(() => {
    if (!data?.projects.length) {
      setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId) {
      const activeQuote = (data.quotes ?? []).find((q) => q.active_for_pm);
      if (activeQuote) {
        const linked = data.projects.find((p) => p.quote_id === activeQuote.id);
        if (linked) {
          setSelectedProjectId(linked.id);
          return;
        }
      }
      const preferred = data.projects.find((p) => !(p.status === "COMPLETED" || (p.completion_pct ?? 0) >= 100));
      setSelectedProjectId((preferred ?? data.projects[0]).id);
      return;
    }
    if (!data.projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [data, selectedProjectId]);

  useEffect(() => {
    try {
      if (selectedProjectId) window.localStorage.setItem(selectionStorageKey, selectedProjectId);
      else window.localStorage.removeItem(selectionStorageKey);
    } catch {
      // Ignore storage errors.
    }
  }, [selectedProjectId, selectionStorageKey]);

  const project = useMemo(
    () => data?.projects.find((p) => p.id === selectedProjectId) ?? null,
    [data, selectedProjectId]
  );
  const openProjects = useMemo(
    () =>
      (data?.projects ?? []).filter(
        (p) => !(p.status === "COMPLETED" || (p.completion_pct ?? 0) >= 100)
      ),
    [data]
  );
  const completedProjects = useMemo(
    () =>
      (data?.projects ?? []).filter(
        (p) => p.status === "COMPLETED" || (p.completion_pct ?? 0) >= 100
      ),
    [data]
  );
  const mergeableProjects = useMemo(
    () => (data?.projects ?? []).filter((p) => !(p.status === "COMPLETED" || (p.completion_pct ?? 0) >= 100)),
    [data]
  );
  const overallCompletionPct = useMemo(() => {
    const all = data?.projects ?? [];
    if (all.length === 0) return 0;
    return Math.round(all.reduce((sum, p) => sum + (p.completion_pct ?? 0), 0) / all.length);
  }, [data]);
  const portfolioStatusLabel = useMemo(() => {
    if ((data?.projects.length ?? 0) === 0) return "No projects";
    if (openProjects.length === 0 && completedProjects.length > 0) return "All projects completed";
    if ((data?.projects ?? []).some((p) => p.status === "AT_RISK" || p.status === "DELAYED" || p.status === "OVERDUE")) {
      return "Attention needed";
    }
    return "Active";
  }, [data, openProjects.length, completedProjects.length]);
  const latestUpdates = useMemo(
    () =>
      (project?.sprints ?? [])
        .flatMap((s) =>
          s.updates.map((u) => ({
            ...u,
            sprintId: s.id,
            sprintTitle: s.title,
            sprintStatus: s.status,
          }))
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [project]
  );
  const calculatedProjectEndDate = useMemo(() => {
    if (!project) return "";
    const dates = project.sprints
      .map((s) => s.estimated_completion_date || s.target_end_at)
      .filter(Boolean)
      .map((d) => new Date(d as string))
      .filter((d) => !Number.isNaN(d.getTime()));
    if (!dates.length) return "";
    return toDateInputValue(new Date(Math.max(...dates.map((d) => d.getTime()))));
  }, [project]);
  const selectedSprint = useMemo(
    () => project?.sprints.find((s) => s.id === selectedSprintId) ?? project?.sprints[0] ?? null,
    [project, selectedSprintId]
  );
  const visibleSprints = useMemo(() => (selectedSprint ? [selectedSprint] : []), [selectedSprint]);

  useEffect(() => {
    setProjectWindowStartDate(toDateInputValue(project?.target_start_at));
    setProjectWindowEndDate(toDateInputValue(project?.target_end_at));
  }, [project?.id, project?.target_start_at, project?.target_end_at]);

  useEffect(() => {
    if (!project?.sprints?.length) {
      setSelectedSprintId(null);
      return;
    }
    if (!selectedSprintId || !project.sprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(project.sprints[0].id);
    }
  }, [project, selectedSprintId]);

  async function createProject() {
    if (!newProjectQuoteId) return;
    if (createProjectMode === "existing" && !existingProjectTargetId) {
      setError("Select an open project to add this quote scope into.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id: newProjectQuoteId,
          allow_duplicate_quote_project: createProjectMode === "new" ? creatingDuplicate : false,
          existing_project_id: createProjectMode === "existing" ? existingProjectTargetId : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409 && createProjectMode === "new") {
          setCreatingDuplicate(true);
          if (json?.duplicate_project?.id) {
            setSelectedProjectId(json.duplicate_project.id);
            setCreateProjectMode("existing");
            setExistingProjectTargetId(json.duplicate_project.id);
            await load();
            return;
          }
          throw new Error("A project already exists for this quote. Select it from the dropdown to continue.");
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

  async function lockProjects() {
    if (!newProjectQuoteId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/projects`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: newProjectQuoteId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to lock projects");
      await load();
      if (json?.project_id) setSelectedProjectId(json.project_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to lock projects");
    } finally {
      setBusy(false);
    }
  }

  async function saveProjectWindow() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/projects/${project.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_start_at: projectWindowStartDate
            ? new Date(`${projectWindowStartDate}T12:00:00.000Z`).toISOString()
            : null,
          target_end_at: projectWindowEndDate
            ? new Date(`${projectWindowEndDate}T12:00:00.000Z`).toISOString()
            : null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to save project timeline");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save project timeline");
    } finally {
      setBusy(false);
    }
  }

  function toggleScopeLock(scopeId: string) {
    setLockedScopeIds((prev) => {
      const next = { ...prev, [scopeId]: !prev[scopeId] };
      try {
        window.localStorage.setItem(scopeLockStorageKey, JSON.stringify(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
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
          from_status: project.sprints.find((s) => s.id === sprintId)?.status ?? undefined,
          to_status: statusLabel,
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

  async function deleteProjectScopeRow(sprintId: string) {
    if (!project) return;
    const ok = window.confirm("Delete this project scope?");
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/projects/${project.id}/sprints/${sprintId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to delete project scope");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete project scope");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link href={`/admin/crm/organizations/${organizationId}`} className="text-xs font-black uppercase tracking-wider hover:underline" style={{ color: BRAND.cyan }}>
              ← Back to Organization Account
            </Link>
            <h1 className="mt-2 text-2xl font-black tracking-tight" style={{ color: BRAND.dark }}>
              PM Workspace
            </h1>
            <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Track delivery by sprint, capture status updates, and generate an anonymized AI overview.
            </p>
          </div>
          <Link
            href="/admin/crm"
            className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
            style={adminPremiumActionStyle}
          >
            CRM Hub
          </Link>
        </header>

        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}

        <section className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ActionRail>
              <MetricChip label="Projects" value={String(data?.projects.length ?? 0)} />
              <MetricChip
                label="At risk"
                value={String((data?.projects ?? []).filter((p) => p.status === "AT_RISK" || p.status === "DELAYED" || p.status === "OVERDUE").length)}
              />
              <MetricChip
                label="Avg completion"
                value={`${Math.round(((data?.projects ?? []).reduce((sum, p) => sum + p.completion_pct, 0) / Math.max(1, data?.projects.length ?? 1)))}%`}
              />
            </ActionRail>
            <ActionRail>
              {(["list", "board", "timeline"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setActiveView(v)}
                  className="rounded-2xl px-3 py-1.5 text-xs font-black uppercase tracking-wide transition hover:-translate-y-[1px]"
                  style={
                    activeView === v
                      ? { border: `1px solid ${BRAND.dark}`, background: BRAND.dark, color: "#fff" }
                      : adminPremiumActionStyle
                  }
                >
                  {v}
                </button>
              ))}
            </ActionRail>
          </div>
        </section>

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
              onChange={(e) => {
                const quoteId = e.target.value;
                setNewProjectQuoteId(quoteId);
                setCreatingDuplicate(false);
                if (!quoteId) return;
                const linked = (data?.projects ?? []).find((p) => p.quote_id === quoteId);
                if (linked) {
                  setSelectedProjectId(linked.id);
                  setCreateProjectMode("existing");
                  setExistingProjectTargetId(linked.id);
                }
              }}
              className="rounded-xl border px-3 py-2 text-sm font-semibold"
              style={{ borderColor: BRAND.border }}
            >
              <option value="">Select quote</option>
              {data?.quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.active_for_pm ? "ACTIVE · " : ""}
                  {q.status} · {fmtMoney(q.total_cents)} · {new Date(q.updated_at).toLocaleDateString()}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-3 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide" style={{ borderColor: BRAND.border }}>
              <label className="inline-flex items-center gap-1">
                <input type="radio" checked={createProjectMode === "new"} onChange={() => setCreateProjectMode("new")} />
                Start new project
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  checked={createProjectMode === "existing"}
                  onChange={() => setCreateProjectMode("existing")}
                />
                Add to existing
              </label>
            </div>
            {createProjectMode === "existing" ? (
              <select
                value={existingProjectTargetId}
                onChange={(e) => setExistingProjectTargetId(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{ borderColor: BRAND.border }}
              >
                <option value="">Select open project</option>
                {(data?.projects ?? []).map((p) => {
                  const completed = p.status === "COMPLETED" || (p.completion_pct ?? 0) >= 100;
                  return (
                    <option key={p.id} value={p.id} disabled={completed}>
                      {completed ? "Completed (locked) · " : ""}
                      {formatProjectDisplayTitle(p.title, `Project ${p.id.slice(0, 6)}`)} · {p.completion_pct}% complete
                    </option>
                  );
                })}
              </select>
            ) : null}
            <button
              type="button"
              onClick={lockProjects}
              disabled={busy || !newProjectQuoteId}
              className="rounded-xl border px-4 py-2 text-sm font-black uppercase disabled:opacity-50"
              style={{ borderColor: BRAND.dark, color: BRAND.dark }}
            >
              Lock projects
            </button>
            <button
              type="button"
              onClick={createProject}
              disabled={busy || !newProjectQuoteId || (createProjectMode === "existing" && !existingProjectTargetId)}
              className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              style={{ background: BRAND.dark }}
            >
              {createProjectMode === "existing"
                ? "Add quote scope to project"
                : creatingDuplicate
                  ? "Confirm duplicate project"
                  : "Bootstrap project"}
            </button>
          </div>
          {creatingDuplicate ? (
            <p className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
              Duplicate mode enabled for this quote. Click again only if you truly want two projects from one quote.
            </p>
          ) : null}
          {createProjectMode === "existing" && mergeableProjects.length === 0 ? (
            <p className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
              No open projects available. Start a new project instead.
            </p>
          ) : null}
          <p className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
            Lock projects saves this quote for PM handoff, keeps it active in this workspace, and reopens linked projects without re-bootstrapping.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              {(data?.organization.name ?? "Organization")} — Open Projects
            </div>
            <div className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
              {portfolioStatusLabel} • {overallCompletionPct}% overall completion
            </div>
            <div className="mt-2 space-y-2">
              {openProjects.map((p) => (
                <div
                  key={p.id}
                  className="w-full rounded-lg border px-3 py-2"
                  style={{
                    borderColor: p.id === selectedProjectId ? BRAND.dark : BRAND.border,
                    background: p.id === selectedProjectId ? "rgba(23,52,100,0.06)" : "#fff",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(p.id);
                      setSelectedSprintId(p.sprints[0]?.id ?? null);
                    }}
                    className="w-full text-left text-sm font-semibold"
                  >
                    <div>
                      {formatWorkspaceProjectTitle({
                        raw: p.title,
                        fallback: `Project ${p.id.slice(0, 6)}`,
                        organizationName: data?.organization.name ?? "Organization",
                        ordinal: (data?.projects.findIndex((x) => x.id === p.id) ?? 0) + 1,
                      })}
                    </div>
                    <div className="text-xs" style={{ color: BRAND.muted }}>
                      {p.status} · {p.completion_pct}% complete
                    </div>
                  </button>
                  <div className="mt-2 space-y-1">
                    {(p.sprints ?? []).map((s) => {
                      const selected = p.id === selectedProjectId && s.id === selectedSprintId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedProjectId(p.id);
                            setSelectedSprintId(s.id);
                          }}
                          className="w-full rounded border px-2 py-1 text-left text-[11px] font-semibold"
                          style={{
                            borderColor: selected ? BRAND.dark : BRAND.border,
                            color: selected ? BRAND.dark : BRAND.muted,
                            background: selected ? "rgba(23,52,100,0.09)" : "rgba(2, 132, 199, 0.04)",
                          }}
                        >
                          <div>
                            Project Scope {s.sprint_number}: {s.title || `Scope ${s.sprint_number}`}
                          </div>
                          <div>{s.completion_pct}% complete</div>
                        </button>
                      );
                    })}
                    {!(p.sprints ?? []).length ? (
                      <div className="text-[11px] font-semibold" style={{ color: BRAND.muted }}>
                        No scopes yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {!openProjects.length ? (
                <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                  No open projects.
                </div>
              ) : null}
            </div>
            <div className="mt-4 border-t pt-3" style={{ borderColor: BRAND.border }}>
              <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                Completed Projects
              </div>
              <div className="mt-2 space-y-2">
                {completedProjects.map((p) => (
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
                    <div>
                      {formatWorkspaceProjectTitle({
                        raw: p.title,
                        fallback: `Project ${p.id.slice(0, 6)}`,
                        organizationName: data?.organization.name ?? "Organization",
                        ordinal: (data?.projects.findIndex((x) => x.id === p.id) ?? 0) + 1,
                      })}
                    </div>
                    <div className="text-xs" style={{ color: BRAND.muted }}>
                      Completed • {new Date(p.updated_at).toLocaleDateString()}
                    </div>
                  </button>
                ))}
                {!completedProjects.length ? (
                  <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                    No completed projects yet.
                  </div>
                ) : null}
              </div>
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
                    <h2 className="text-lg font-black" style={{ color: BRAND.dark }}>
                      {formatWorkspaceProjectTitle({
                        raw: project.title,
                        fallback: `Project ${project.id.slice(0, 6)}`,
                        organizationName: data?.organization.name ?? "Organization",
                        ordinal: (data?.projects.findIndex((x) => x.id === project.id) ?? 0) + 1,
                      })}
                    </h2>
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
                <section className="rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                    Overall Project Window
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                      Start
                      <input
                        type="date"
                        value={projectWindowStartDate}
                        onChange={(e) => setProjectWindowStartDate(e.target.value)}
                        className="mt-1 block rounded border px-2 py-1 text-xs font-semibold"
                        style={{ borderColor: BRAND.border }}
                      />
                    </label>
                    <label className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                      Estimated End
                      <input
                        type="date"
                        value={projectWindowEndDate}
                        onChange={(e) => setProjectWindowEndDate(e.target.value)}
                        className="mt-1 block rounded border px-2 py-1 text-xs font-semibold"
                        style={{ borderColor: BRAND.border }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setProjectWindowEndDate(calculatedProjectEndDate)}
                      disabled={!calculatedProjectEndDate}
                      className="rounded border px-2 py-1 text-xs font-black uppercase disabled:opacity-50"
                      style={{ borderColor: BRAND.border }}
                    >
                      Use scope-based end date
                    </button>
                    <button
                      type="button"
                      onClick={saveProjectWindow}
                      disabled={busy}
                      className="rounded border px-2 py-1 text-xs font-black uppercase disabled:opacity-50"
                      style={{ borderColor: BRAND.dark, color: BRAND.dark }}
                    >
                      Save timeline
                    </button>
                  </div>
                </section>

                {project.last_ai_summary ? (
                  <div className="rounded-xl border px-3 py-3 text-sm font-semibold whitespace-pre-wrap" style={{ borderColor: BRAND.border, background: "rgba(52,176,180,0.06)" }}>
                    {project.last_ai_summary}
                  </div>
                ) : null}

                {activeView === "board" ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    {(["NOT_STARTED", "ON_TIME", "DELAYED", "OVERDUE", "COMPLETED"] as const).map((statusCol) => (
                      <div key={statusCol} className="rounded-xl border p-3" style={{ borderColor: BRAND.border, background: "#F8FAFC" }}>
                        <div className="mb-2 text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                          {statusCol.replaceAll("_", " ")}
                        </div>
                        <div className="space-y-2">
                          {visibleSprints
                            .filter((s) => s.status === statusCol)
                            .map((s) => (
                              <div key={s.id} className="rounded-lg border bg-white p-2" style={{ borderColor: BRAND.border }}>
                                <div className="text-sm font-black" style={{ color: BRAND.dark }}>
                                  {s.title}
                                </div>
                                <div className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                                  {s.completion_pct}% complete
                                </div>
                              </div>
                            ))}
                          {visibleSprints.filter((s) => s.status === statusCol).length === 0 ? (
                            <div className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                              No items
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {activeView === "timeline" ? (
                  <div className="rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
                    <div className="space-y-2">
                      {visibleSprints.map((s) => {
                        const end = s.estimated_completion_date ? new Date(s.estimated_completion_date).toLocaleDateString() : "TBD";
                        return (
                          <div key={s.id} className="rounded-lg border p-2" style={{ borderColor: BRAND.border }}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-black" style={{ color: BRAND.dark }}>{s.title}</div>
                              <StatusBadge label={s.status.replaceAll("_", " ")} />
                            </div>
                            <div className="mt-1 text-xs font-semibold" style={{ color: BRAND.muted }}>
                              Target end: {end}
                            </div>
                            <div className="mt-2 h-2 w-full rounded bg-slate-100">
                              <div className="h-2 rounded" style={{ width: `${s.completion_pct}%`, background: BRAND.cyan }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {activeView === "list" ? <div className="space-y-3">
                  {(selectedSprint ? [selectedSprint] : []).map((s) => (
                    <div key={s.id} className="rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-black" style={{ color: BRAND.dark }}>
                          Project Scope {s.sprint_number}: {s.title}
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
                          <button
                            type="button"
                            onClick={() => deleteProjectScopeRow(s.id)}
                            disabled={busy}
                            className="rounded border px-2 py-1 text-xs font-black uppercase disabled:opacity-50"
                            style={{ borderColor: BRAND.danger, color: BRAND.danger }}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleScopeLock(s.id)}
                            className="rounded border px-2 py-1 text-xs font-black uppercase"
                            style={{ borderColor: BRAND.border, color: BRAND.dark }}
                          >
                            {lockedScopeIds[s.id] ? "Edit scope" : "Save scope"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <input
                          value={s.title}
                          onChange={(e) => patchSprint(s.id, { title: e.target.value })}
                          disabled={lockedScopeIds[s.id]}
                          className="rounded border px-2 py-1 text-xs font-semibold"
                          style={{ borderColor: BRAND.border }}
                          placeholder="Title"
                        />
                        <input
                          value={s.cost_band ?? ""}
                          onChange={(e) => patchSprint(s.id, { cost_band: e.target.value || null })}
                          disabled={lockedScopeIds[s.id]}
                          className="rounded border px-2 py-1 text-xs font-semibold"
                          style={{ borderColor: BRAND.border }}
                          placeholder="Cost band"
                        />
                        <div className="flex gap-2 md:col-span-2">
                          <input
                            type="number"
                            min={0.1}
                            step={0.1}
                            value={s.estimated_duration_value ?? ""}
                            onChange={(e) =>
                              patchSprint(s.id, {
                                estimated_duration_value: Math.max(
                                  0.1,
                                  Number(e.target.value) || 0.1
                                ),
                              })
                            }
                            disabled={lockedScopeIds[s.id]}
                            className="w-24 rounded border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: BRAND.border }}
                            placeholder="Duration"
                          />
                          <select
                            value={s.estimated_duration_unit ?? "weeks"}
                            onChange={(e) =>
                              patchSprint(s.id, { estimated_duration_unit: e.target.value })
                            }
                            disabled={lockedScopeIds[s.id]}
                            className="rounded border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: BRAND.border }}
                          >
                            {["hours", "days", "weeks", "months"].map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                          <input
                            type="date"
                            value={toDateInputValue(s.estimated_completion_date)}
                            onChange={(e) =>
                              patchSprint(s.id, {
                                estimated_completion_date: e.target.value
                                  ? new Date(`${e.target.value}T12:00:00.000Z`).toISOString()
                                  : null,
                              })
                            }
                            disabled={lockedScopeIds[s.id]}
                            className="rounded border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: BRAND.border }}
                          />
                        </div>
                        {(() => {
                          const parsedScope = parseScopeSummarySections(s.scope_summary);
                          const saveSections = (patch: Partial<typeof parsedScope>) => {
                            const merged = composeScopeSummarySections({
                              scopeSummary: patch.scopeSummary ?? parsedScope.scopeSummary,
                              deliverables: patch.deliverables ?? parsedScope.deliverables,
                              projectedTools: patch.projectedTools ?? parsedScope.projectedTools,
                            });
                            patchSprint(s.id, { scope_summary: merged || null });
                          };
                          return (
                            <div className="md:col-span-2 grid gap-2">
                              <label className="text-[11px] font-black uppercase tracking-wide" style={{ color: BRAND.greyBlue }}>
                                Scope Summary
                                <textarea
                                  value={parsedScope.scopeSummary}
                                  onChange={(e) => saveSections({ scopeSummary: e.target.value })}
                                  disabled={lockedScopeIds[s.id]}
                                  className="mt-1 min-h-[64px] w-full rounded border px-2 py-1 text-xs font-semibold"
                                  style={{ borderColor: BRAND.border }}
                                  placeholder="Scope summary"
                                />
                              </label>
                              <label className="text-[11px] font-black uppercase tracking-wide" style={{ color: BRAND.greyBlue }}>
                                What we will deliver
                                <textarea
                                  value={parsedScope.deliverables}
                                  onChange={(e) => saveSections({ deliverables: e.target.value })}
                                  disabled={lockedScopeIds[s.id]}
                                  className="mt-1 min-h-[64px] w-full rounded border px-2 py-1 text-xs font-semibold"
                                  style={{ borderColor: BRAND.border }}
                                  placeholder="One deliverable per line"
                                />
                              </label>
                              <label className="text-[11px] font-black uppercase tracking-wide" style={{ color: BRAND.greyBlue }}>
                                Projected Tools
                                <textarea
                                  value={parsedScope.projectedTools}
                                  onChange={(e) => saveSections({ projectedTools: e.target.value })}
                                  disabled={lockedScopeIds[s.id]}
                                  className="mt-1 min-h-[56px] w-full rounded border px-2 py-1 text-xs font-semibold"
                                  style={{ borderColor: BRAND.border }}
                                  placeholder="One tool per line"
                                />
                              </label>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
                        Estimated timeline: {s.estimated_duration_value ?? "—"} {s.estimated_duration_unit ?? ""}
                        {s.estimated_completion_date
                          ? ` • Estimated completion date: ${new Date(
                              s.estimated_completion_date
                            ).toLocaleDateString()}`
                          : ""}
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
                          Latest: {s.updates[0].status_label}{" "}
                          {parseWhyWithTransition(s.updates[0].why_text).whyText
                            ? `— ${parseWhyWithTransition(s.updates[0].why_text).whyText}`
                            : ""}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!selectedSprint ? (
                    <div className="rounded-xl border p-3 text-sm font-semibold" style={{ borderColor: BRAND.border, color: BRAND.muted }}>
                      Select a project scope from the left toolbar.
                    </div>
                  ) : null}
                </div> : null}

                <section className="rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                    Status + Why Timeline
                  </div>
                  <div className="mt-2 space-y-2">
                    {latestUpdates.slice(0, 10).map((u) => {
                      const parsedWhy = parseWhyWithTransition(u.why_text);
                      return (
                        <div key={u.id} className="rounded-lg border p-2 text-xs" style={{ borderColor: BRAND.border }}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-black" style={{ color: BRAND.dark }}>{u.status_label}</div>
                            <StatusBadge label={u.sprintStatus.replaceAll("_", " ")} />
                          </div>
                          <div className="mt-1 font-semibold" style={{ color: BRAND.muted }}>
                            {u.sprintTitle} • {new Date(u.created_at).toLocaleString()} • {u.author_email ?? "admin"}
                          </div>
                          {(parsedWhy.fromStatus || parsedWhy.toStatus) ? (
                            <div className="mt-1 font-semibold" style={{ color: BRAND.dark }}>
                              Transition: {parsedWhy.fromStatus ?? "—"} → {parsedWhy.toStatus ?? "—"}
                            </div>
                          ) : null}
                          {parsedWhy.whyText ? (
                            <div className="mt-1 font-semibold" style={{ color: BRAND.dark }}>
                              Why: {parsedWhy.whyText}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {latestUpdates.length === 0 ? (
                      <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                        No status updates recorded yet.
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            )}
          </main>
        </section>
    </AdminShell>
  );
}

