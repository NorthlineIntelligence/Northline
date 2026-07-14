"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";
import { AiProcessingModeToggle, type AiProcessingMode } from "@/components/priority-discovery/AiProcessingModeToggle";

type ExistingAssessment = {
  id: string;
  name: string;
  assessmentType: "READINESS" | "PRIORITY_DISCOVERY";
  cohortName?: string | null;
};

type CreateAssessmentModalProps = {
  organizationId: string;
  existingAssessments: ExistingAssessment[];
  onClose: () => void;
  onCreated?: (assessmentId: string) => void;
};

export function CreateAssessmentModal(props: CreateAssessmentModalProps) {
  const router = useRouter();
  const fieldClassName =
    "rounded-lg border bg-white px-3 py-2 text-sm text-[#173464] placeholder:text-[#66819e]";
  const [name, setName] = useState("");
  const [cohortName, setCohortName] = useState("");
  const [assessmentType, setAssessmentType] = useState<"READINESS" | "PRIORITY_DISCOVERY">("PRIORITY_DISCOVERY");
  const [aiProcessingMode, setAiProcessingMode] = useState<AiProcessingMode>("executive");
  const [parentAssessmentId, setParentAssessmentId] = useState("");
  const [copySource, setCopySource] = useState<"default" | "parent" | "assessment" | "none">("default");
  const [copyAssessmentId, setCopyAssessmentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priorityAssessments = useMemo(
    () => props.existingAssessments.filter((a) => a.assessmentType === "PRIORITY_DISCOVERY"),
    [props.existingAssessments]
  );

  async function createAssessment() {
    if (!name.trim()) {
      setError("Assessment name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    let copyQuestionsFrom:
      | { type: "default" }
      | { type: "assessment"; assessmentId: string }
      | { type: "none" }
      | undefined;

    if (assessmentType === "PRIORITY_DISCOVERY") {
      if (copySource === "none") copyQuestionsFrom = { type: "none" };
      else if (copySource === "parent" && parentAssessmentId) {
        copyQuestionsFrom = { type: "assessment", assessmentId: parentAssessmentId };
      } else if (copySource === "assessment" && copyAssessmentId) {
        copyQuestionsFrom = { type: "assessment", assessmentId: copyAssessmentId };
      } else {
        copyQuestionsFrom = { type: "default" };
      }
    }

    try {
      const res = await fetch(`/api/admin/organizations/${props.organizationId}/assessments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          cohortName: cohortName.trim() || undefined,
          assessmentType,
          aiProcessingMode: assessmentType === "PRIORITY_DISCOVERY" ? aiProcessingMode : undefined,
          parentAssessmentId: parentAssessmentId || undefined,
          copyQuestionsFrom,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `Create failed (${res.status}).`);
        setSaving(false);
        return;
      }

      props.onCreated?.(json.assessment.id);
      router.push(`/admin/assessments/${json.assessment.id}`);
      props.onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-white p-6 shadow-xl" style={{ borderColor: BRAND.border }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em]" style={{ color: BRAND.cyan }}>
              New assessment phase
            </div>
            <h2 className="mt-2 text-2xl font-semibold" style={{ color: BRAND.dark }}>
              Create Assessment
            </h2>
            <p className="mt-1 text-sm" style={{ color: BRAND.greyBlue }}>
              Add a second phase for the same client — for example, executive Priority Discovery first, then a modified staff version.
            </p>
          </div>
          <button type="button" onClick={props.onClose} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: BRAND.border }}>
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-semibold" style={{ color: BRAND.dark }}>Assessment name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="AI Priority Discovery — Staff Phase"
              className={fieldClassName}
              style={{ borderColor: BRAND.border }}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold" style={{ color: BRAND.dark }}>Cohort / phase label (optional)</span>
            <input
              value={cohortName}
              onChange={(e) => setCohortName(e.target.value)}
              placeholder="Executive Team, Staff, Operations Leaders"
              className={fieldClassName}
              style={{ borderColor: BRAND.border }}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold" style={{ color: BRAND.dark }}>Assessment module</span>
            <select
              value={assessmentType}
              onChange={(e) => setAssessmentType(e.target.value as "READINESS" | "PRIORITY_DISCOVERY")}
              className={fieldClassName}
              style={{ borderColor: BRAND.border }}
            >
              <option value="PRIORITY_DISCOVERY">AI Priority Discovery Assessment</option>
              <option value="READINESS">AI Readiness Assessment</option>
            </select>
          </label>

          {priorityAssessments.length > 0 ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold" style={{ color: BRAND.dark }}>Follows prior assessment (optional)</span>
              <select
                value={parentAssessmentId}
                onChange={(e) => setParentAssessmentId(e.target.value)}
                className={fieldClassName}
                style={{ borderColor: BRAND.border }}
              >
                <option value="">No linked prior phase</option>
                {priorityAssessments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.cohortName ? ` (${a.cohortName})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {assessmentType === "PRIORITY_DISCOVERY" ? (
            <>
              <AiProcessingModeToggle value={aiProcessingMode} onChange={setAiProcessingMode} />

              <div className="grid gap-2">
                <span className="text-sm font-semibold" style={{ color: BRAND.dark }}>Question set starting point</span>
                <select
                  value={copySource}
                  onChange={(e) => setCopySource(e.target.value as typeof copySource)}
                  className={fieldClassName}
                  style={{ borderColor: BRAND.border }}
                >
                  <option value="default">Copy default Priority Discovery question bank</option>
                  {parentAssessmentId ? <option value="parent">Copy questions from linked prior assessment</option> : null}
                  <option value="assessment">Copy questions from another assessment</option>
                  <option value="none">Start empty (add questions manually)</option>
                </select>
                <p className="text-xs" style={{ color: BRAND.greyBlue }}>
                  You can edit, deactivate, and reorder questions on the assessment page before sending invites.
                </p>
              </div>

              {copySource === "assessment" ? (
                <label className="grid gap-2">
                  <span className="text-sm font-semibold" style={{ color: BRAND.dark }}>Copy from assessment</span>
                  <select
                    value={copyAssessmentId}
                    onChange={(e) => setCopyAssessmentId(e.target.value)}
                    className={fieldClassName}
                    style={{ borderColor: BRAND.border }}
                  >
                    <option value="">Select assessment</option>
                    {priorityAssessments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.cohortName ? ` (${a.cohortName})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: "#FECDCA", color: "#B42318" }}>
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="rounded-lg border px-4 py-2 text-sm font-semibold" style={{ borderColor: BRAND.border }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={createAssessment}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: saving ? "#98a2b3" : BRAND.dark }}
          >
            {saving ? "Creating…" : "Create Assessment"}
          </button>
        </div>
      </div>
    </div>
  );
}
