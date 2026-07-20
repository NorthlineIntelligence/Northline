"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";

type RoadmapPhase = {
  phaseNumber: number;
  title: string;
  durationLabel: string;
  durationDays: number;
  goals: string[];
  deliverables: string[];
  milestones: string[];
  tools: string[];
  dependencies: string[];
  risks: string[];
};

type Roadmap = {
  rank: number;
  priorityProjectId: string;
  projectName: string;
  executiveSummary: string;
  objectives: string[];
  successCriteria: string[];
  phases: RoadmapPhase[];
  recommendedTools: string[];
  staffingNotes: string;
  readinessPrerequisites: string[];
  firstThirtyDays: string[];
};

type BundlePayload = {
  bundleNotes?: string;
  roadmaps?: Roadmap[];
};

type BundleResponse = {
  ok: boolean;
  bundle: {
    id: string;
    assessmentId: string;
    organizationId: string;
    roadmaps: BundlePayload | Roadmap[];
    pmProjectIds: string[] | null;
    createdAt: string;
  } | null;
  error?: string;
};

function asRoadmaps(value: BundlePayload | Roadmap[] | null | undefined): Roadmap[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.roadmaps)) return value.roadmaps;
  return [];
}

function bundleNotes(value: BundlePayload | Roadmap[] | null | undefined): string {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.bundleNotes === "string") {
    return value.bundleNotes;
  }
  return "";
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
        {title}
      </div>
      <ul className="mt-2 space-y-1 text-sm font-semibold" style={{ color: BRAND.dark }}>
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span style={{ color: BRAND.cyan }}>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PriorityRoadmapsPage() {
  const params = useParams<{ id: string }>();
  const assessmentId = params.id;
  const [bundle, setBundle] = useState<BundleResponse["bundle"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/priority-discovery/assessments/${assessmentId}/roadmaps`, {
          credentials: "include",
        });
        const json = (await res.json()) as BundleResponse;
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load roadmaps.");
        if (!cancelled) setBundle(json.bundle);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load roadmaps.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const roadmaps = asRoadmaps(bundle?.roadmaps);
  const notes = bundleNotes(bundle?.roadmaps);

  return (
    <div className="min-h-screen px-4 py-8 md:px-8" style={{ background: shellBackground }}>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Admin delivery planning
            </div>
            <h1 className="mt-1 text-2xl font-black" style={{ color: BRAND.dark }}>
              Priority Discovery PM roadmaps
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/assessments/${assessmentId}/priority-results`}
              className="rounded-xl border px-4 py-2 text-sm font-bold"
              style={{ borderColor: BRAND.border, color: BRAND.dark, background: "white" }}
            >
              ← Executive readout
            </Link>
            {bundle?.organizationId ? (
              <Link
                href={`/admin/crm/organizations/${bundle.organizationId}/projects`}
                className="rounded-xl px-4 py-2 text-sm font-bold text-white"
                style={{ background: BRAND.cyan }}
              >
                Open PM workspace →
              </Link>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="mt-8 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Loading roadmaps…
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-2xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: BRAND.danger, color: BRAND.danger }}>
            {error}
          </div>
        ) : null}

        {!loading && !error && !bundle ? (
          <div className="mt-8 rounded-2xl border bg-white/95 p-6 text-sm font-semibold shadow-sm" style={{ borderColor: BRAND.border, color: BRAND.muted }}>
            No roadmaps generated yet. Use the organization page Deliverables section to generate PM roadmaps from the Top 5.
          </div>
        ) : null}

        {notes ? (
          <div className="mt-8 rounded-2xl border bg-white/95 p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Cross-project sequencing
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed" style={{ color: BRAND.dark }}>
              {notes}
            </p>
          </div>
        ) : null}

        <div className="mt-8 space-y-6">
          {roadmaps.map((roadmap) => (
            <section
              key={roadmap.priorityProjectId}
              className="rounded-2xl border bg-white/95 p-6 shadow-sm"
              style={{ borderColor: BRAND.border }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.cyan }}>
                    Top {roadmap.rank}
                  </div>
                  <h2 className="mt-1 text-xl font-black" style={{ color: BRAND.dark }}>
                    {roadmap.projectName}
                  </h2>
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap text-sm font-semibold leading-relaxed" style={{ color: BRAND.dark }}>
                {roadmap.executiveSummary}
              </p>

              <ListBlock title="Objectives" items={roadmap.objectives} />
              <ListBlock title="Success criteria" items={roadmap.successCriteria} />
              <ListBlock title="First 30 days" items={roadmap.firstThirtyDays} />
              <ListBlock title="Recommended tools" items={roadmap.recommendedTools} />
              {roadmap.staffingNotes ? (
                <div className="mt-4 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: BRAND.surfaceMuted, color: BRAND.dark }}>
                  <span className="font-black">Staffing:</span> {roadmap.staffingNotes}
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {roadmap.phases.map((phase) => (
                  <div
                    key={`${roadmap.rank}-${phase.phaseNumber}`}
                    className="rounded-xl border p-4"
                    style={{ borderColor: BRAND.border, background: BRAND.surfaceMuted }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-black" style={{ color: BRAND.dark }}>
                        Phase {phase.phaseNumber}: {phase.title}
                      </div>
                      <div className="text-xs font-bold" style={{ color: BRAND.muted }}>
                        {phase.durationLabel}
                      </div>
                    </div>
                    <ListBlock title="Goals" items={phase.goals} />
                    <ListBlock title="Deliverables" items={phase.deliverables} />
                    <ListBlock title="Milestones" items={phase.milestones} />
                    <ListBlock title="Tools" items={phase.tools} />
                    <ListBlock title="Dependencies" items={phase.dependencies} />
                    <ListBlock title="Risks" items={phase.risks} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
