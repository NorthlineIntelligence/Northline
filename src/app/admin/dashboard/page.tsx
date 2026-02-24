import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

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
            href="/admin/session"
            className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="text-base font-semibold">Session Viewer</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Confirm auth cookies + Supabase session payload.
            </div>
          </a>

          <div className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm">
            <div className="text-base font-semibold">Next: Authorization</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Add org/assessment membership rules (beyond admin allowlist).
            </div>
          </div>

          <div className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm">
            <div className="text-base font-semibold">Next: Documents</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Upload + store org-specific context (Storage + metadata).
            </div>
          </div>

          <div className="rounded-2xl border border-[#cdd8df] bg-white p-5 shadow-sm">
            <div className="text-base font-semibold">Next: Reporting UI</div>
            <div className="mt-1 text-sm text-[#66819e]">
              Boardroom-ready results + radar chart scaffolding.
            </div>
          </div>
        </div>

        <footer className="mt-10 border-t border-[#cdd8df] pt-6 text-xs text-[#66819e]">
          Version: 1 • Admin access is restricted.
        </footer>
      </div>
    </div>
  );
}