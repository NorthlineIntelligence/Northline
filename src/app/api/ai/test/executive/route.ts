import { NextResponse } from "next/server";
import { getAdminApiUser } from "@/lib/adminApiAuth";
import { testExecutiveModelConnection } from "@/lib/ai/modelRouter";

export async function POST() {
  const auth = await getAdminApiUser();
  if (!auth.ok) return auth.response;

  const result = await testExecutiveModelConnection();
  return NextResponse.json(result);
}
