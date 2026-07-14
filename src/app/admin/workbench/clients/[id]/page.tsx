import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkbenchShell } from "@/components/workbench/WorkbenchShell";
import { StatusPill, WbButton, WbCard, formatBytes, formatDate } from "@/components/workbench/ui";
import {
  getAssessmentsForClient,
  getClientById,
  getDocumentsForClient,
  getOutputsForClient,
} from "@/lib/workbench/mockData";
import { WORKBENCH_BRAND as WB } from "@/lib/workbench/theme";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = getClientById(id);
  if (!client) notFound();

  const documents = getDocumentsForClient(id);
  const assessments = getAssessmentsForClient(id);
  const outputs = getOutputsForClient(id);

  return (
    <WorkbenchShell
      title={client.name}
      subtitle={`${client.industry} · ${client.businessSize}`}
      actions={
        <>
          <StatusPill label={client.status} tone="accent" />
          <WbButton href="/admin/workbench/analysis">Run analysis</WbButton>
          <WbButton href="/admin/workbench/documents">Upload documents</WbButton>
        </>
      }
    >
      <WbCard className="mb-6">
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>Notes</h2>
        <p className="mt-2 text-sm font-medium leading-relaxed" style={{ color: WB.muted }}>{client.notes}</p>
      </WbCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Documents" items={documents.map((d) => ({ id: d.id, primary: d.name, meta: `${d.fileType} · ${formatBytes(d.sizeBytes)}`, badge: d.processingStatus }))} empty="No documents uploaded." />
        <Section title="Assessments" items={assessments.map((a) => ({ id: a.id, primary: a.title, meta: a.analysisType, badge: a.status }))} empty="No assessments yet." />
        <Section title="AI outputs" items={outputs.map((o) => ({ id: o.id, primary: o.title, meta: o.type, badge: o.status }))} empty="No outputs generated." linkPrefix="/admin/workbench/outputs" />
      </div>

      <p className="mt-6 text-xs font-medium" style={{ color: WB.greyBlue }}>
        Updated {formatDate(client.updatedAt)} · <Link href="/admin/workbench/clients" className="underline">All clients</Link>
      </p>
    </WorkbenchShell>
  );
}

function Section({
  title,
  items,
  empty,
  linkPrefix,
}: {
  title: string;
  items: { id: string; primary: string; meta: string; badge: string }[];
  empty: string;
  linkPrefix?: string;
}) {
  return (
    <WbCard>
      <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: WB.greyBlue }}>{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm font-medium" style={{ color: WB.muted }}>{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border px-3 py-2" style={{ borderColor: WB.border }}>
              <p className="text-sm font-semibold" style={{ color: WB.dark }}>{item.primary}</p>
              <p className="text-xs font-medium" style={{ color: WB.muted }}>{item.meta}</p>
              <StatusPill label={item.badge} tone="neutral" />
            </li>
          ))}
        </ul>
      )}
    </WbCard>
  );
}
