import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

const DEPARTMENTS = [
  { label: "Org-wide (None)", value: "" },
  { label: "Sales", value: "SALES" },
  { label: "Marketing", value: "MARKETING" },
  { label: "Customer Success", value: "CUSTOMER_SUCCESS" },
  { label: "Ops", value: "OPS" },
  { label: "RevOps", value: "REVOPS" },
  { label: "GTM", value: "GTM" },
] as const;

export default async function AdminAssessmentsPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/admin/login");

  const assessments = await prisma.assessment.findMany({
    orderBy: { created_at: "desc" },
    include: {
      organization: { select: { name: true } },
    },
  });

  return (
    <div className="min-h-screen bg-[#fcfcfe] text-[#173464]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Assessments</h1>
          <a
            href="/admin/dashboard"
            className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm shadow-sm hover:shadow"
          >
            Back to Dashboard
          </a>
        </div>

        <p className="mt-2 text-sm text-[#66819e]">
          Set <b>Locked Dept</b> to force team-only mode (bypasses participant department selection).
        </p>

        <div className="mt-6 overflow-auto rounded-xl border border-[#e6eaf2] bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f6f8fc]">
              <tr>
                <th className="px-4 py-3 text-left">Org</th>
                <th className="px-4 py-3 text-left">Assessment</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Locked Dept</th>
                <th className="px-4 py-3 text-left">Locked At</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>

            <tbody>
              {assessments.map((a) => (
                <tr key={a.id} className="border-t border-[#e6eaf2]">
                  <td className="px-4 py-3">{a.organization?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.name ?? "—"}</div>
                    <div className="text-xs text-[#66819e]">{a.id}</div>
                  </td>
                  <td className="px-4 py-3">{a.status}</td>

                  <td className="px-4 py-3">
                    <select
                      defaultValue={a.locked_department ?? ""}
                      className="rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm"
                      name={`locked_department__${a.id}`}
                    >
                      {DEPARTMENTS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-4 py-3">
                    {a.locked_at ? new Date(a.locked_at).toLocaleString() : "—"}
                  </td>

                  <td className="px-4 py-3 space-y-2">
  <a
    href={`/admin/assessments/${a.id}`}
    className="inline-block rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm font-semibold text-[#173464] shadow-sm hover:shadow"
  >
    Edit Organization →
  </a>

  <form
    action={async (formData) => {
      "use server";
      const selected = String(formData.get(`locked_department__${a.id}`) ?? "");
      const locked_department = selected.length ? selected : null;

      await prisma.assessment.update({
        where: { id: a.id },
        data: { locked_department: locked_department as any },
      });
    }}
  >
    <button
      type="submit"
      className="rounded-lg bg-[#173464] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95"
    >
      Save
    </button>
  </form>

  {a.locked_at && (
    <a
      href={`/assessments/${a.id}/results`}
      className="inline-block rounded-lg bg-[#34b0b4] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95"
    >
      View Results →
    </a>
  )}

  <div className="text-xs text-[#66819e]">Saves to DB immediately.</div>
</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-xl border border-[#e6eaf2] bg-white p-4 text-xs text-[#66819e]">
          Tip: If an assessment has <b>locked_at</b> set (narrative generated), department changes are blocked for participants.
          Admin can still set/clear <b>locked_department</b> here for routing behavior, but it won’t change existing participant data.
        </div>
      </div>
    </div>
  );
}