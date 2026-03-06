import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

interface PageProps {
  params: Promise<{
    id?: string;
  }>;
}

export default async function OrganizationSettingsPage({ params }: PageProps) {
  await requireAdmin();

  const { id } = await params;

  const orgId = id;
  if (!orgId) {
    notFound();
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      assessments: {
        orderBy: { created_at: "desc" },
        include: {
          Participant: {
            select: {
              id: true,
              email: true,
              user_id: true,
              department: true,
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          },
        },
      },
    },
  });

  if (!org) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#fcfcfe] text-[#173464]">
      <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Organization Settings
              </h1>
              <p className="mt-2 text-sm text-[#66819e]">
                Manage org context and share assessment start links.
              </p>
            </div>

            <a
              href="/admin/dashboard"
              className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
            >
              Back to Dashboard →
            </a>
          </div>
        </header>

        <div className="rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold text-[#66819e]">Name</div>
              <div className="mt-1 text-base font-semibold text-[#173464]">
                {org.name}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#66819e]">Created</div>
              <div className="mt-1 text-sm text-[#173464]">
                {new Date(org.created_at).toLocaleDateString()}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#66819e]">
                Total Assessments
              </div>
              <div className="mt-1 text-sm text-[#173464]">
                {org.assessments.length}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="text-lg font-semibold">Invite Links</div>
          <div className="mt-1 text-sm text-[#66819e]">
            Copy/paste these links to participants. Email automation comes later.
          </div>

          {org.assessments.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[#cdd8df] bg-white p-5 text-sm text-[#66819e] shadow-sm">
              No assessments yet for this organization.
            </div>
          ) : (
            <div className="mt-4 grid gap-4">
              {org.assessments.map((a) => {
                const startPath = `/assessments/${a.id}`;
                const participants = (a.Participant ?? []).filter(
                  (p) => (p.email ?? "").trim().length > 0
                );

                return (
                  <div
                    key={a.id}
                    className="rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-sm"
                  >
                    
                    <div className="flex items-start justify-between gap-4">
  <div>
    <div className="text-base font-semibold">Assessment</div>
    <div className="mt-1 text-sm text-[#66819e]">
      Created {new Date(a.created_at).toLocaleString()}
    </div>
  </div>

  <div className="flex items-center gap-2">
    <a
      href={`/admin/assessments/${a.id}`}
      className="rounded-lg bg-[#173464] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
    >
      Manage Assessment →
    </a>

    <a
      href={`/admin/assessments/${a.id}/dashboard`}
      className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
    >
      Reporting Dashboard →
    </a>

    <a
      href={startPath}
      className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
    >
      Open start page →
    </a>
  </div>
</div>

                    <div className="mt-4">
                      <div className="text-sm font-semibold">Start link</div>
                      <div className="mt-2 rounded-xl border border-[#e9eef4] bg-[#f6f8fc] p-3 text-xs font-mono text-[#173464] break-all">
                        {startPath}
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="text-sm font-semibold">Participants</div>

                      {participants.length === 0 ? (
                        <div className="mt-2 text-sm text-[#66819e]">
                          No participant emails on this assessment yet.
                        </div>
                      ) : (
                        <ul className="mt-2 space-y-1 pl-5 text-sm">
                          {participants.map((p) => (
                            <li key={p.id}>
                              <span className="font-semibold">
                                {p.email}
                              </span>
                              {p.department ? (
                                <span className="text-[#66819e]">
                                  {" "}
                                  •{" "}
                                  {String(p.department).replaceAll("_", " ")}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="mt-10 border-t border-[#cdd8df] pt-6 text-xs text-[#66819e]">
          Version: 1 • Admin access is restricted.
        </footer>
      </div>
    </div>
  );
}