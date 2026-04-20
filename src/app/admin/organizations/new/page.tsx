import { requireAdmin } from "@/lib/admin";
import { INDUSTRY_OPTIONS } from "@/lib/assessmentIndustry";
import Link from "next/link";
import IntakeDocumentDropInput from "./IntakeDocumentDropInput";

export default async function NewOrganizationPage() {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-[#fcfcfe] text-[#173464]">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                New Organization Intake
              </h1>
              <p className="mt-2 text-sm text-[#66819e]">
                Create an organization, configure assessment type, and add participants.
              </p>
            </div>
            <Link
              href="/admin/dashboard"
              className="inline-flex rounded-lg border border-[#cdd8df] bg-white px-4 py-2 text-sm font-medium text-[#173464] shadow-sm hover:shadow-md"
            >
              Back to Admin Dashboard
            </Link>
          </div>
        </header>

        <form
          action="/api/admin/onboard"
          method="post"
          encType="multipart/form-data"
          className="space-y-8"
        >
          {/* Organization Info */}
          <div className="rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-sm space-y-4">
            <div className="text-base font-semibold">Organization Details</div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Organization Name
              </label>
              <input
                name="name"
                required
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Website
              </label>
              <input
                name="website"
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Industry
              </label>
              <select
                name="industry"
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
                defaultValue=""
              >
                <option value="">Select industry</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Context Notes (What they do, positioning, etc.)
              </label>
              <textarea
                name="context_notes"
                rows={5}
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Organization Documents for AI Grounding
              </label>
              <IntakeDocumentDropInput name="documents" />
              <p className="mt-2 text-xs text-[#66819e]">
                Optional. Upload up to 10 files (2MB each). Text/markdown/csv/json/log/PDF files are best for AI
                grounding and are scrubbed to remove organization names.
              </p>
            </div>
          </div>

          {/* Assessment Setup */}
          <div className="rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-sm space-y-4">
            <div className="text-base font-semibold">Assessment Configuration</div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Assessment Type
              </label>
              <select
                name="assessment_type"
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              >
                <option value="FULL">Full Organization</option>
                <option value="DEPARTMENT">Single Department</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Assessment Industry (question set)
              </label>
              <select
                name="assessment_industry"
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
                defaultValue=""
              >
                <option value="">Not set (all industries)</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Locked Department (if applicable)
              </label>
              <select
                name="locked_department"
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              >
                <option value="">None</option>
                <option value="SALES">Sales</option>
                <option value="MARKETING">Marketing</option>
                <option value="CUSTOMER_SUCCESS">Customer Success</option>
                <option value="OPS">Ops</option>
                <option value="REVOPS">RevOps</option>
                <option value="GTM">GTM</option>
              </select>
            </div>
          </div>

                    {/* Participants */}
                    <div className="rounded-2xl border border-[#cdd8df] bg-white p-6 shadow-sm space-y-4">
            <div className="text-base font-semibold">Participants</div>

            <div className="text-sm text-[#66819e]">
              Enter participant emails one at a time (up to 10). Leave unused rows blank.
              (Comma-separated paste still works as a fallback.)
            </div>

            <div className="space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <input
                  key={i}
                  name="participant_email"
                  type="email"
                  placeholder={`person${i === 0 ? "" : ` ${i + 1}`}@company.com`}
                  className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
                />
              ))}
            </div>

            {/* Fallback: comma-separated paste (still accepted by API) */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Or paste a comma-separated list (optional)
              </label>
              <textarea
                name="participant_emails"
                rows={2}
                placeholder="person1@company.com, person2@company.com"
                className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            className="rounded-lg border border-[#cdd8df] bg-white px-5 py-3 text-sm font-medium shadow-sm hover:shadow-md"
          >
            Create Organization & Start Assessment
          </button>
        </form>
      </div>
    </div>
  );
}