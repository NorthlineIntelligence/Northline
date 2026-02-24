"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const forbidden = searchParams.get("error") === "forbidden";

  const supabase = useMemo(() => {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset password UI state
  const [resetMode, setResetMode] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResetNotice(null);
    setSubmitting(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.replace("/admin/dashboard");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function onResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResetNotice(null);
    setResetSubmitting(true);

    try {
      // Where Supabase will send the user back after they click the email link.
      // We'll build that page next (one step at a time).
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/admin/reset`
          : undefined;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined
      );

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setResetNotice(
        "If an account exists for that email, a password reset link has been sent."
      );
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fcfcfe] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#cdd8df] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-[#173464]">
          Northline Admin Access
        </h1>
        <p className="mt-2 text-sm text-[#66819e]">
          {resetMode
            ? "Request a password reset link."
            : "Sign in with your administrative account."}
        </p>

        {forbidden && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">
              Unauthorized Access
            </p>
            <p className="mt-1 text-sm text-red-700">
              Your account does not have permission to access the administrative
              dashboard. If you believe this is an error, please contact your
              system administrator.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">
              {resetMode ? "Request failed" : "Sign-in failed"}
            </p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        )}

        {resetNotice && (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-900">
              Check your email
            </p>
            <p className="mt-1 text-sm text-emerald-800">{resetNotice}</p>
          </div>
        )}

        {!resetMode ? (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#173464]">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm text-[#173464] outline-none focus:ring-2 focus:ring-[#34b0b4]"
                placeholder="you@northlineintelligence.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#173464]">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm text-[#173464] outline-none focus:ring-2 focus:ring-[#34b0b4]"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#173464] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setResetMode(true);
                  setError(null);
                  setResetNotice(null);
                }}
                className="text-sm font-medium text-[#173464] underline underline-offset-4 hover:opacity-90"
              >
                Reset your password
              </button>

              <p className="text-xs text-[#66819e]">
                Restricted to admins.
              </p>
            </div>
          </form>
        ) : (
          <form onSubmit={onResetPassword} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#173464]">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#cdd8df] bg-white px-3 py-2 text-sm text-[#173464] outline-none focus:ring-2 focus:ring-[#34b0b4]"
                placeholder="you@northlineintelligence.com"
                required
              />
              <p className="mt-2 text-xs text-[#66819e]">
                We’ll email a reset link if an account exists for this address.
              </p>
            </div>

            <button
              type="submit"
              disabled={resetSubmitting}
              className="w-full rounded-lg bg-[#173464] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-60"
            >
              {resetSubmitting ? "Sending..." : "Send reset link"}
            </button>

            <button
              type="button"
              onClick={() => {
                setResetMode(false);
                setError(null);
                setResetNotice(null);
              }}
              className="w-full rounded-lg border border-[#cdd8df] bg-white px-4 py-2 text-sm font-medium text-[#173464] shadow-sm transition hover:shadow"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
