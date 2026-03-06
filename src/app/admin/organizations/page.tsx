import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

export default async function AdminOrganizationsPage() {
  await requireAdmin();

  const orgs = await prisma.organization.findMany({
    orderBy: { created_at: "desc" },
    take: 50,
    include: {
      _count: {
        select: { assessments: true },
      },
      assessments: {
        orderBy: { created_at: "desc" },
        take: 1,
        select: { id: true, created_at: true },
      },
    },
  });

  return (
    <div className="min-h-screen bg-[#fcfcfe] text-[#173464]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Organizations
            </h1>
            <p className="mt-2 text-sm text-[#66819e]">
              Manage orgs, view settings, and jump into the latest assessment.
            </p>
          </div>

          <a
            href="/admin/organizations/new"
            className="rounded-lg border border-[#cdd8df] bg-white px-4 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
          >
            + Create New Organization
          </a>
        </header>

        <div className="grid gap-4">
          {orgs.length === 0 ? (
            <div className="rounded-2xl border border-[#cdd8df] bg-white p-6 text-sm text-[#66819e] shadow-sm">
              No organizations yet.
            </div>
          ) : (
            orgs.map((org) => {
              const latestAssessmentId = org.assessments?.[0]?.id ?? null;

              return (
                <div
                  key={org.id}
                  className="rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-base font-semibold">{org.name}</div>
                      <div className="mt-1 text-sm text-[#66819e]">
                        Created {new Date(org.created_at).toLocaleDateString()} •{" "}
                        {org._count.assessments} assessment
                        {org._count.assessments === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/admin/organizations/${org.id}`}
                        className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
                      >
                        Org Settings
                      </a>

                      {latestAssessmentId ? (
                        <a
                          href={`/assessments/${latestAssessmentId}/results`}
                          className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
                        >
                          Latest Results
                        </a>
                      ) : (
                        <span className="rounded-lg border border-[#e9eef4] bg-[#f6f8fc] px-3 py-2 text-sm text-[#66819e]">
                          No assessments yet
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="mt-10 border-t border-[#cdd8df] pt-6 text-xs text-[#66819e]">
          Version: 1 • Admin access is restricted.
        </footer>
      </div>
    </div>
  );
}