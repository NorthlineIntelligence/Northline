"use client";

import { NORTHLINE_BRAND as BRAND } from "@/lib/northlineBrand";
import type { ClientSpecificInternalReadout } from "@/lib/priorityDiscovery/clientSpecificReadout";
import { ConsultantNotesPanel } from "@/components/priority-discovery/ConsultantNotesPanel";

function severityStyle(severity: string) {
  if (severity === "critical") return { bg: "#FEE4E2", fg: "#B42318" };
  if (severity === "high") return { bg: "#FEE4E2", fg: "#B42318" };
  if (severity === "low") return { bg: "#ECFDF3", fg: "#027A48" };
  return { bg: "#FFFAEB", fg: "#B54708" };
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
        {title}
      </div>
      <ul className="mt-2 space-y-1 text-sm font-semibold leading-6" style={{ color: BRAND.dark }}>
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

function InlineTextBlock({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
      <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
        {title}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6" style={{ color: BRAND.dark }}>
        {text}
      </p>
    </div>
  );
}

export function ClientSpecificInternalReadoutView({
  assessmentId,
  analysisId,
  consultantNotesHtml,
  internalReadout,
  createdAt,
  onNotesSaved,
}: {
  assessmentId: string;
  analysisId: string;
  consultantNotesHtml: string | null;
  internalReadout: ClientSpecificInternalReadout;
  createdAt: string;
  onNotesSaved: (html: string | null) => void;
}) {
  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <div className="text-xs font-black uppercase tracking-[0.14em]" style={{ color: BRAND.cyan }}>
          Internal brief
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7" style={{ color: BRAND.dark }}>
          {internalReadout.internalBrief}
        </p>
        <div className="mt-4 text-xs font-semibold" style={{ color: BRAND.greyBlue }}>
          Generated {new Date(createdAt).toLocaleString()}
        </div>
      </section>

      <ConsultantNotesPanel
        analysisId={analysisId}
        assessmentId={assessmentId}
        initialHtml={consultantNotesHtml}
        onSaved={onNotesSaved}
      />

      <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <h2 className="text-lg font-semibold">Client context snapshot</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ListSection title="Stated pressures" items={internalReadout.clientContext.statedPressures} />
          <ListSection title="Tech stack" items={internalReadout.clientContext.techStack} />
          <ListSection title="Integrations" items={internalReadout.clientContext.integrations} />
          <ListSection title="Workflows" items={internalReadout.clientContext.workflows} />
        </div>
      </section>

      {internalReadout.documentFindings.length ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
          <h2 className="text-lg font-semibold">Document findings</h2>
          <div className="mt-4 grid gap-4">
            {internalReadout.documentFindings.map((doc) => (
              <div key={doc.documentTitle} className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                <div className="font-semibold">{doc.documentTitle}</div>
                {doc.sourceType ? (
                  <div className="mt-1 text-xs font-semibold" style={{ color: BRAND.greyBlue }}>
                    {doc.sourceType}
                  </div>
                ) : null}
                <ListSection title="Key facts" items={doc.keyFacts} />
                <ListSection title="Gaps" items={doc.gaps} />
                <ListSection title="Contradictions" items={doc.contradictions} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <h2 className="text-lg font-semibold">Assessment findings</h2>
        <div className="mt-2 text-sm font-semibold" style={{ color: BRAND.greyBlue }}>
          {internalReadout.assessmentFindings.participantCount} participants ·{" "}
          {internalReadout.assessmentFindings.responseCount} responses
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ListSection title="Consensus themes" items={internalReadout.assessmentFindings.consensusThemes} />
          <ListSection title="Contradictions" items={internalReadout.assessmentFindings.contradictions} />
          <ListSection title="Blind spots" items={internalReadout.assessmentFindings.blindSpots} />
          <ListSection title="Leadership vs team gaps" items={internalReadout.assessmentFindings.leadershipVsTeamGaps} />
        </div>
      </section>

      {internalReadout.systemsAndWorkflows.length ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
          <h2 className="text-lg font-semibold">Systems and workflows</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {internalReadout.systemsAndWorkflows.map((item) => (
              <div key={item.name} className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                <div className="font-semibold">{item.name}</div>
                <p className="mt-2 text-sm leading-6" style={{ color: BRAND.dark }}>
                  {item.currentState}
                </p>
                <ListSection title="Pain points" items={item.painPoints} />
                <ListSection title="Gaps" items={item.gaps} />
                <ListSection title="Evidence" items={item.evidence} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {internalReadout.criticalGaps.length ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
          <h2 className="text-lg font-semibold">Critical gaps</h2>
          <div className="mt-4 grid gap-4">
            {internalReadout.criticalGaps.map((gap) => {
              const colors = severityStyle(gap.severity);
              return (
                <div key={gap.gap} className="rounded-xl border p-4" style={{ borderColor: BRAND.border, background: "#F9FAFB" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">{gap.gap}</div>
                    <span className="rounded-full px-3 py-1 text-xs font-black uppercase" style={{ background: colors.bg, color: colors.fg }}>
                      {gap.severity}
                    </span>
                  </div>
                  <ListSection title="Evidence" items={gap.evidence} />
                  <p className="mt-2 text-sm leading-6">
                    <b>Blocks:</b> {gap.blocksWhat}
                  </p>
                  <p className="mt-1 text-sm leading-6">
                    <b>Recommended fix:</b> {gap.recommendedFix}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {internalReadout.readinessBlockers.length ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
          <h2 className="text-lg font-semibold">Readiness blockers</h2>
          <ListSection title="Known blockers" items={internalReadout.readinessBlockers} />
        </section>
      ) : null}

      {internalReadout.participantQuotes.length ? (
        <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
          <h2 className="text-lg font-semibold">Participant quotes</h2>
          <div className="mt-4 grid gap-3">
            {internalReadout.participantQuotes.map((entry, index) => (
              <blockquote
                key={`${entry.question}-${index}`}
                className="rounded-lg border-l-4 bg-[#f9fafb] p-4 text-sm leading-6"
                style={{ borderColor: BRAND.cyan }}
              >
                <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  {[entry.participantRole, entry.participantDepartment].filter(Boolean).join(" · ") || "Participant"}
                </div>
                <div className="mt-1 font-semibold" style={{ color: BRAND.dark }}>
                  {entry.question}
                </div>
                <div className="mt-2">{entry.quote}</div>
                {entry.significance ? (
                  <div className="mt-2 text-xs font-semibold" style={{ color: BRAND.greyBlue }}>
                    {entry.significance}
                  </div>
                ) : null}
              </blockquote>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <h2 className="text-lg font-semibold">Strategic notes</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <InlineTextBlock title="What leadership believes" text={internalReadout.strategicNotes.whatLeadershipBelieves} />
          <InlineTextBlock title="What teams experience" text={internalReadout.strategicNotes.whatTeamsExperience} />
        </div>
        <ListSection title="Document vs assessment conflicts" items={internalReadout.strategicNotes.documentVsAssessmentConflicts} />
        <ListSection title="Where to push back" items={internalReadout.strategicNotes.whereToPushBack} />
        <ListSection title="Where to align" items={internalReadout.strategicNotes.whereToAlign} />
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <h2 className="text-lg font-semibold">Consultant working notes</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7" style={{ color: BRAND.dark }}>
          {internalReadout.consultantWorkingNotes}
        </p>
      </section>
      <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BRAND.border }}>
        <h2 className="text-lg font-semibold">Follow-up</h2>
        <ListSection title="Recommended investigations" items={internalReadout.recommendedInvestigations} />
        <ListSection title="Missing inputs" items={internalReadout.missingInputs} />
      </section>
    </div>
  );
}
