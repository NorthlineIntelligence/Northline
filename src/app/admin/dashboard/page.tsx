import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import AdminControlsToggleButton from "../AdminControlsToggleButton";
import ProjectScopeToggleButton from "../ProjectScopeToggleButton";
import DeleteOrganizationButton from "../DeleteOrganizationButton";
export default async function AdminDashboardPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // no-op: this page only reads auth state
        },
      },
    }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // If the session is invalid/expired or user cannot be verified, treat as logged out.
  if (userError || !user) redirect("/admin/login");

  const email = user.email ?? "unknown";

  const recentOrgs = await prisma.organization.findMany({
    orderBy: { created_at: "desc" },
    take: 10,
    select: {
      id: true,
      name: true,
      industry: true,
      created_at: true,
      show_admin_controls: true,
      show_project_scope_review: true,
      _count: { select: { assessments: true } },
    },
  });

  return (
    <div className="min-h-screen bg-[#fcfcfe] text-[#173464]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-[#34b0b4]" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Northline Admin
              </h1>
            </div>

            <form action="/admin/logout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
              >
                Log out
              </button>
            </form>
          </div>

          <p className="text-sm text-[#66819e]">
            Signed in as{" "}
            <span className="font-medium text-[#173464]">{email}</span>
          </p>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <a
            href="/admin/crm"
            className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="text-base font-semibold">Client CRM</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Pipeline, Executive Insights links, project scope quotes, contracts, and invoices.
            </div>
          </a>

          <a
            href="/admin/organizations/new"
            className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="text-base font-semibold">Create New Organization</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Intake org context, set assessment type, add participants.
            </div>
          </a>

          <a
            href="/admin/session"
            className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="text-base font-semibold">Session Viewer</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Confirm auth cookies + Supabase session payload.
            </div>
          </a>

          <a
            href="/admin/questions/ingest"
            className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="text-base font-semibold">Question Ingestion</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Upload a CSV, preview questions, and import into the question bank.
            </div>
          </a>

          <div className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm">
            <div className="text-base font-semibold">Next: Documents</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Upload + store org-specific context (Storage + metadata).
            </div>
          </div>
        </div>

        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Recent Organizations</div>
              <div className="text-sm text-[#66819e]">
                Newest first • Click to open Org Settings
              </div>
            </div>

            <a
              href="/admin/organizations/new"
              className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
            >
              + New Organization
            </a>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#cdd8df] bg-white shadow-sm">
            {recentOrgs.length === 0 ? (
              <div className="p-5 text-sm text-[#66819e]">
                No organizations yet. Create your first one.
              </div>
            ) : (
              <div className="divide-y divide-[#e9eef4]">
                {recentOrgs.map((org) => (
                  <div
                    key={org.id}
                    className="flex flex-col gap-3 p-5 transition hover:bg-[#f6f8fc] sm:flex-row sm:items-stretch"
                  >
                    <a
                      href={`/admin/organizations/${org.id}`}
                      className="min-w-0 flex-1 rounded-lg outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#34b0b4]"
                    >
                      <div className="text-base font-semibold">{org.name}</div>
                      <div className="mt-1 text-sm text-[#66819e]">
                        {org.industry ? org.industry : "Industry not set"} •{" "}
                        {org._count.assessments} assessment
                        {org._count.assessments === 1 ? "" : "s"}
                      </div>
                    </a>

                    <div className="flex shrink-0 flex-col items-stretch gap-3 border-t border-[#e9eef4] pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                      <div className="text-xs text-[#66819e] sm:text-right">
                        {new Date(org.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex flex-col items-stretch gap-2 sm:items-end">
                        <AdminControlsToggleButton
                          organizationId={org.id}
                          initialEnabled={Boolean(org.show_admin_controls)}
                        />
                        <ProjectScopeToggleButton
                          organizationId={org.id}
                          initialEnabled={Boolean(org.show_project_scope_review)}
                        />
                        <div className="flex justify-end sm:justify-end">
                          <DeleteOrganizationButton
                            organizationId={org.id}
                            organizationName={org.name}
                            variant="icon"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="mt-10 border-t border-[#cdd8df] pt-6 text-xs text-[#66819e]">
          Version: 1 • Admin access is restricted.
        </footer>
      </div>
    </div>
  );
}