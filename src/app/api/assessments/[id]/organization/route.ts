import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // ignore
        }
      },
    },
  });
}

async function requireAdminUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  }

  const email = (user.email ?? "").trim().toLowerCase();
  if (!isAdminEmail(email)) {
    return { ok: false as const, status: 403 as const, error: "Forbidden" };
  }

  return { ok: true as const, user, email };
}

async function loadAssessmentAndLock(assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      organization_id: true,
      Participant: { select: { id: true, completed_at: true } },
    },
  });

  if (!assessment) {
    return {
      ok: false as const,
      status: 404 as const,
      error: "Assessment not found",
    };
  }

  const participantsTotal = assessment.Participant.length;
  const participantsCompleted = assessment.Participant.filter(
    (p) => p.completed_at !== null
  ).length;

  const isLocked =
    participantsTotal > 0 && participantsCompleted === participantsTotal;

  return {
    ok: true as const,
    assessment,
    participantsTotal,
    participantsCompleted,
    isLocked,
  };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminUser();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: assessmentId } = await context.params;

  const loaded = await loadAssessmentAndLock(assessmentId);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: loaded.assessment.organization_id },
    select: {
      id: true,
      name: true,
      industry: true,
      size: true,
      growth_stage: true,
      primary_pressures: true,
      website: true,
      context_notes: true,
      show_admin_controls: true,
    },
  });

  if (!organization) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    isLocked: loaded.isLocked,
    participantsTotal: loaded.participantsTotal,
    participantsCompleted: loaded.participantsCompleted,
    organization,
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminUser();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: assessmentId } = await context.params;

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const loaded = await loadAssessmentAndLock(assessmentId);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  if (loaded.isLocked) {
    return NextResponse.json(
      { error: "Assessment is locked. Organization is read-only." },
      { status: 423 }
    );
  }

  const nextName =
    typeof payload?.name === "string" ? payload.name.trim() : undefined;

  const nextIndustry =
    typeof payload?.industry === "string" ? payload.industry.trim() : null;

  const nextSize =
    typeof payload?.size === "string" ? payload.size.trim() : null;

  const nextGrowthStage =
    typeof payload?.growth_stage === "string"
      ? payload.growth_stage.trim()
      : null;

  const nextPrimaryPressures =
    typeof payload?.primary_pressures === "string"
      ? payload.primary_pressures.trim()
      : null;

  const nextWebsite =
    typeof payload?.website === "string" ? payload.website.trim() : null;

  const nextContextNotes =
    typeof payload?.context_notes === "string" ? payload.context_notes : null;

  const nextShowAdminControls =
    typeof payload?.show_admin_controls === "boolean"
      ? payload.show_admin_controls
      : undefined;

  if (!nextName) {
    return NextResponse.json(
      { error: "Organization name is required" },
      { status: 400 }
    );
  }

  const updated = await prisma.organization.update({
    where: { id: loaded.assessment.organization_id },
    data: {
      name: nextName,
      industry: nextIndustry,
      size: nextSize,
      growth_stage: nextGrowthStage,
      primary_pressures: nextPrimaryPressures,
      website: nextWebsite,
      context_notes: nextContextNotes,
      ...(typeof nextShowAdminControls === "boolean"
        ? { show_admin_controls: nextShowAdminControls }
        : {}),
    },
    select: {
      id: true,
      name: true,
      industry: true,
      size: true,
      growth_stage: true,
      primary_pressures: true,
      website: true,
      context_notes: true,
      show_admin_controls: true,
    },
  });

  return NextResponse.json({
    ok: true,
    organization: updated,
  });
}