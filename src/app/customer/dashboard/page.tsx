import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { NORTHLINE_BRAND as BRAND, NORTHLINE_SHELL_BG as shellBackground } from "@/lib/northlineBrand";
import { getCustomerPortalViewer } from "@/lib/customerPortalAuth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

function fmtDate(iso: Date | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

async function getAdminPreviewUser() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // no-op
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email || !isAdminEmail(user.email)) return null;
  return user;
}

export default async function CustomerDashboardPage(props: {
  searchParams?: Promise<{ assessmentId?: string; preview?: string }>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const previewAssessmentId =
    typeof searchParams.assessmentId === "string" ? searchParams.assessmentId : null;
  const isPreviewMode = (searchParams.preview ?? "").toLowerCase() === "1";

  const viewer = await getCustomerPortalViewer();
  const adminUser = !viewer && isPreviewMode && previewAssessmentId ? await getAdminPreviewUser() : null;

  if (!viewer && !adminUser) redirect("/customer/access?error=no_portal_access");

  const assessmentId = viewer?.participant.assessment_id ?? previewAssessmentId;
  if (!assessmentId) redirect("/customer/access?error=no_portal_access");

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      status: true,
      created_at: true,
      organization: { select: { name: true, id: true } },
      Participant: {
        where: { email: { not: null } },
        select: { email: true, completed_at: true, invite_sent_at: true, portal_role: true },
        orderBy: { created_at: "asc" },
      },
    },
  });

  if (!assessment) redirect("/customer/access?error=no_portal_access");

  const total = assessment.Participant.length;
  const completed = assessment.Participant.filter((p) => p.completed_at != null).length;
  const displayEmail = viewer?.userEmail ?? adminUser?.email ?? "customer@northline";
  const firstName = (displayEmail.split("@")[0] || "Customer").replace(/[._-]/g, " ");
  const participantRole =
    viewer?.participant.portal_role ??
    (adminUser ? "ORG_ADMIN" : "PORTAL_USER");

  return (
    <main style={{ minHeight: "100vh", background: shellBackground, padding: 24 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <div
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 18,
            padding: 20,
            boxShadow: "0 12px 36px rgba(15, 23, 42, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ color: BRAND.dark, fontWeight: 900, fontSize: 22 }}>Northline Customer Dashboard</div>
            <div style={{ color: BRAND.dark, fontWeight: 750, marginTop: 4 }}>
              {assessment.organization.name} • Signed in as {firstName}
            </div>
            {adminUser ? (
              <div
                style={{
                  marginTop: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 900,
                  color: BRAND.dark,
                  background: "#F8FAFC",
                }}
              >
                Admin Preview
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div
              style={{
                border: `1px solid ${BRAND.border}`,
                borderRadius: 999,
                padding: "6px 10px",
                background: "#F8FAFC",
                color: BRAND.dark,
                fontWeight: 850,
                fontSize: 12,
              }}
            >
              Assessment completion: {completed}/{total}
            </div>
            <Link
              href={`/assessments/${assessment.id}/narrative`}
              style={{
                background: BRAND.dark,
                color: "white",
                textDecoration: "none",
                borderRadius: 12,
                padding: "10px 14px",
                fontWeight: 900,
              }}
            >
              Open Executive Insights
            </Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
          <section
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 16,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>Assessment Period Status</div>
            <div style={{ marginTop: 8, color: BRAND.dark, fontWeight: 750 }}>
              Track participation and readiness artifact progress in one place.
            </div>
            <div style={{ marginTop: 14, display: "grid", gap: 8, color: BRAND.dark, fontWeight: 700 }}>
              <div>Assessment ID: {assessment.id}</div>
              <div>Status: {assessment.status}</div>
              <div>Created: {fmtDate(assessment.created_at)}</div>
              <div>Your portal role: {participantRole === "ORG_ADMIN" ? "Org Admin" : "Portal User"}</div>
            </div>
          </section>

          <section
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.border}`,
              borderRadius: 16,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>Engagement Modules</div>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <LockedModule title="Document Library" subtitle="Unlocks after MSA lifecycle stage." />
              <LockedModule title="PM Workspace" subtitle="Customer PM portal arrives in next phase." />
            </div>
          </section>
        </div>

        <section
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.border}`,
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.dark }}>Participant Progress</div>
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Email</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Invite Sent</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {assessment.Participant.map((p, i) => (
                  <tr key={`${p.email}-${i}`}>
                    <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}`, color: BRAND.dark }}>
                      {p.email ?? "—"}
                    </td>
                    <td style={{ padding: 10, borderBottom: `1px solid ${BRAND.border}` }}>{fmtDate(p.invite_sent_at)}</td>
                    <td
                      style={{
                        padding: 10,
                        borderBottom: `1px solid ${BRAND.border}`,
                        fontWeight: 850,
                        color: BRAND.dark,
                      }}
                    >
                      {p.completed_at ? "Completed" : "In progress"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function LockedModule({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        border: `1px solid ${BRAND.border}`,
        borderRadius: 12,
        padding: 12,
        background: "#F8FAFC",
      }}
    >
      <div style={{ color: BRAND.dark, fontWeight: 850 }}>{title}</div>
      <div style={{ color: BRAND.muted, fontWeight: 700, marginTop: 2, fontSize: 12 }}>{subtitle}</div>
    </div>
  );
}
