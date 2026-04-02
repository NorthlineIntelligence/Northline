"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3h6l1 2h5v2H3V5h5l1-2zm-4 6h14l-1 14H6L5 9zm4 3v8h2v-8H9zm4 0v8h2v-8h-2z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function DeleteOrganizationButton(props: {
  organizationId: string;
  organizationName: string;
  /** After delete, client navigates here (default: admin dashboard). */
  redirectHref?: string;
  /** Icon-only for dense rows; full-width destructive button for settings. */
  variant?: "icon" | "button";
}) {
  const { organizationId, organizationName, redirectHref = "/admin/dashboard", variant = "icon" } = props;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(typeof json?.error === "string" ? json.error : `Delete failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.push(redirectHref);
      router.refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setErr(null);
            setOpen(true);
          }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#e9eef4] bg-white text-[#b42318] shadow-sm transition hover:border-[#FED7D7] hover:bg-[#FFF5F5]"
          title={`Delete organization “${organizationName}”`}
          aria-label={`Delete organization ${organizationName}`}
        >
          <TrashIcon />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setErr(null);
            setOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-[#FED7D7] bg-[#FFF5F5] px-4 py-2.5 text-sm font-bold text-[#9B2C2C] shadow-sm transition hover:bg-[#FEE2E2]"
        >
          <TrashIcon />
          Delete organization
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.45)" }}
          role="presentation"
          onClick={() => !deleting && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-org-title"
            className="max-w-md rounded-2xl border border-[#e9eef4] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-org-title" className="text-lg font-bold text-[#173464]">
              Delete organization?
            </h2>
            <p className="mt-3 text-sm font-medium leading-relaxed text-[#4B5565]">
              Are you sure you want to delete this Organization, doing so will delete all data and will be
              unrecoverable.
            </p>
            <p className="mt-2 text-sm text-[#66819e]">
              <span className="font-semibold text-[#173464]">{organizationName}</span> — including assessments,
              participants, responses, narratives, and uploaded documents in the database.
            </p>

            {err ? (
              <p className="mt-3 text-sm font-semibold text-[#b42318]" role="alert">
                {err}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-[#cdd8df] bg-white px-4 py-2 text-sm font-bold text-[#173464] shadow-sm transition hover:bg-[#f6f8fc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="rounded-xl border border-[#b42318] bg-[#b42318] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
