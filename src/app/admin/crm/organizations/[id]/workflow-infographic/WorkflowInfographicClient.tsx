"use client";

import { useEffect, useState } from "react";

export default function WorkflowInfographicClient({ organizationId }: { organizationId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      setLoading(true);
      setError(null);
      setImageUrl(null);
      try {
        const res = await fetch(`/api/admin/crm/organizations/${organizationId}/workflow-map/infographic`, {
          method: "POST",
          credentials: "include",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Failed to generate infographic.");
        if (cancelled) return;
        setImageUrl(typeof json?.infographic_data_url === "string" ? json.infographic_data_url : null);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to generate infographic.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void generate();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function addToCustomerLibrary() {
    if (!imageUrl || !imageUrl.startsWith("data:image/")) {
      setLibraryMessage("No infographic is available to save yet.");
      return;
    }

    setSavingToLibrary(true);
    setLibraryMessage(null);
    try {
      const fetched = await fetch(imageUrl);
      if (!fetched.ok) throw new Error("Could not read generated infographic.");
      const blob = await fetched.blob();
      const ext = blob.type === "image/jpeg" ? "jpg" : "png";
      const filename = `workflow-infographic-${new Date().toISOString().slice(0, 10)}.${ext}`;
      const file = new File([blob], filename, { type: blob.type || "image/png" });

      const form = new FormData();
      form.append("files", file);

      const res = await fetch(`/api/admin/organizations/${organizationId}/documents`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to add infographic to customer library.");
      }
      setLibraryMessage("Infographic added to customer library.");
    } catch (e: unknown) {
      setLibraryMessage(e instanceof Error ? e.message : "Failed to add infographic to customer library.");
    } finally {
      setSavingToLibrary(false);
    }
  }

  return (
    <section className="mx-auto mt-4 w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {loading ? <p className="text-sm font-semibold text-slate-600">Generating infographic...</p> : null}
      {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
      {!loading && !error && imageUrl ? (
        <div>
          <img
            src={imageUrl}
            alt="Workflow map infographic"
            className="w-full rounded-xl border border-slate-200 object-contain"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingToLibrary}
              onClick={() => void addToCustomerLibrary()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {savingToLibrary ? "Adding to library..." : "Add to customer library"}
            </button>
            {libraryMessage ? <p className="text-sm font-semibold text-slate-700">{libraryMessage}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
