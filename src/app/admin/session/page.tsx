"use client";

import { useEffect, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AdminSessionPage() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-[#fcfcfe] px-6 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#cdd8df] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-[#173464]">Admin Session</h1>
        <p className="mt-2 text-sm text-[#66819e]">
          Dev helper: copy your bearer token to call protected endpoints.
        </p>

        {!session ? (
          <p className="mt-6 text-sm text-[#66819e]">
            No session. Go to <code>/admin/login</code> and sign in.
          </p>
        ) : (
          <div className="mt-6">
            <div className="text-sm text-[#173464]">
              Signed in as <span className="font-medium">{session.user.email}</span>
            </div>

            <label className="mt-4 block text-sm font-medium text-[#173464]">
              Bearer Token (access_token)
            </label>
            <textarea
              className="mt-2 w-full rounded-xl border border-[#cdd8df] p-3 text-xs text-[#173464] outline-none focus:ring-2 focus:ring-[#34b0b4]"
              rows={8}
              readOnly
              value={session.access_token}
            />
            <p className="mt-2 text-xs text-[#66819e]">
              Use as: <code>Authorization: Bearer {"<token>"}</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}