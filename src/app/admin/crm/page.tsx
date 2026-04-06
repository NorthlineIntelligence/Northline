import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import {
  NORTHLINE_BRAND as BRAND,
  NORTHLINE_SHELL_BG as shellBg,
} from "@/lib/northlineBrand";
import { CRM_STAGE_LABEL, isCrmFollowUpOverdue } from "@/lib/crmPipeline";
import { CrmPriceBookPanel } from "./CrmPriceBookPanel";

export default async function AdminCrmHubPage() {
  await requireAdmin();

  const orgs = await prisma.organization.findMany({
    orderBy: { created_at: "desc" },
    take: 80,
    select: {
      id: true,
      name: true,
      crm_pipeline_stage: true,
      crm_next_follow_up_at: true,
      created_at: true,
      _count: { select: { assessments: true, crm_invoices: true } },
    },
  });

  const openInvoicesRaw = await prisma.crmInvoice.findMany({
    where: { due_date: { lt: new Date() } },
    select: {
      id: true,
      organization_id: true,
      title: true,
      due_date: true,
      status: true,
    },
    take: 40,
  });
  const terminal = new Set(["PAID", "VOID", "paid", "void"]);
  const openInvoices = openInvoicesRaw.filter((i) => !terminal.has(i.status));

  const overdueFollowUps = orgs.filter((o) =>
    isCrmFollowUpOverdue(o.crm_next_follow_up_at, o.crm_pipeline_stage)
  );

  return (
    <div className="min-h-screen px-6 py-10 text-[0.925rem]" style={{ background: shellBg, color: BRAND.text }}>
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div
              className="text-[11px] font-black uppercase tracking-[0.12em]"
              style={{ color: BRAND.greyBlue }}
            >
              Northline Intelligence
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight" style={{ color: BRAND.dark }}>
              Client CRM
            </h1>
            <p className="mt-2 max-w-xl font-semibold leading-relaxed" style={{ color: BRAND.muted }}>
              Pipeline, quotes tied to assessment scope, contracts, and billing—all in one account view.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/dashboard"
              className="rounded-xl border bg-white px-4 py-2 text-sm font-bold shadow-sm transition hover:shadow"
              style={{ borderColor: BRAND.border, color: BRAND.dark }}
            >
              Admin home
            </Link>
            <Link
              href="/admin/organizations"
              className="rounded-xl border bg-white px-4 py-2 text-sm font-bold shadow-sm transition hover:shadow"
              style={{ borderColor: BRAND.border, color: BRAND.dark }}
            >
              All organizations
            </Link>
          </div>
        </header>

        {(overdueFollowUps.length > 0 || openInvoices.length > 0) && (
          <div
            className="mb-6 grid gap-3 rounded-2xl border p-4 md:grid-cols-2"
            style={{
              borderColor: BRAND.border,
              background: "rgba(180, 35, 24, 0.06)",
              borderLeftWidth: 4,
              borderLeftColor: BRAND.danger,
            }}
          >
            {overdueFollowUps.length > 0 ? (
              <div>
                <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.danger }}>
                  Follow-up overdue
                </div>
                <ul className="mt-2 list-inside list-disc font-bold" style={{ color: BRAND.dark }}>
                  {overdueFollowUps.slice(0, 6).map((o) => (
                    <li key={o.id}>
                      <Link href={`/admin/crm/organizations/${o.id}`} className="underline-offset-2 hover:underline">
                        {o.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {openInvoices.length > 0 ? (
              <div>
                <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.danger }}>
                  Invoices past due
                </div>
                <ul className="mt-2 list-inside list-disc text-sm font-bold" style={{ color: BRAND.dark }}>
                  {openInvoices.slice(0, 6).map((inv) => (
                    <li key={inv.id}>
                      <Link
                        href={`/admin/crm/organizations/${inv.organization_id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {inv.title}
                      </Link>
                      {inv.due_date ? ` — due ${new Date(inv.due_date).toLocaleDateString()}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <div className="mb-10 rounded-2xl border bg-white/95 p-5 shadow-sm backdrop-blur-sm" style={{ borderColor: BRAND.border }}>
          <h2 className="text-lg font-black" style={{ color: BRAND.dark }}>
            Client accounts
          </h2>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Open a profile for pipeline, Executive Insights, project scope, quotes, and documents.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr style={{ color: BRAND.greyBlue }} className="text-xs font-black uppercase tracking-wider">
                  <th className="pb-3 pr-4">Organization</th>
                  <th className="pb-3 pr-4">Stage</th>
                  <th className="pb-3 pr-4">Next follow-up</th>
                  <th className="pb-3 pr-4">Assessments</th>
                  <th className="pb-3">Profile</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => {
                  const overdue = isCrmFollowUpOverdue(o.crm_next_follow_up_at, o.crm_pipeline_stage);
                  return (
                    <tr key={o.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                      <td className="py-3 pr-4">
                        <span style={{ color: BRAND.dark }}>{o.name}</span>
                        {overdue ? (
                          <span
                            className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase"
                            style={{ background: "rgba(180, 35, 24, 0.12)", color: BRAND.danger }}
                          >
                            Overdue
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4" style={{ color: BRAND.dark }}>
                        {CRM_STAGE_LABEL[o.crm_pipeline_stage]}
                      </td>
                      <td className="py-3 pr-4" style={{ color: BRAND.muted }}>
                        {o.crm_next_follow_up_at
                          ? new Date(o.crm_next_follow_up_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="py-3 pr-4" style={{ color: BRAND.muted }}>
                        {o._count.assessments}
                      </td>
                      <td className="py-3">
                        <Link
                          href={`/admin/crm/organizations/${o.id}`}
                          className="inline-flex rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white"
                          style={{ background: BRAND.dark }}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <CrmPriceBookPanel />
      </div>
    </div>
  );
}
