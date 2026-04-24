"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NORTHLINE_BRAND as BRAND,
} from "@/lib/northlineBrand";
import { ADMIN_PREMIUM_BUTTON_STYLE } from "@/lib/adminButtonStyles";
import { ActionRail, AdminShell, MetricChip, SectionCard, StatusBadge, adminPremiumActionStyle } from "@/lib/adminUiPrimitives";
import AdminControlsToggleButton from "@/app/admin/AdminControlsToggleButton";
import ProjectScopeToggleButton from "@/app/admin/ProjectScopeToggleButton";
import SendAssessmentButton from "@/app/admin/organizations/SendAssessmentButton";
import {
  CRM_PIPELINE_ORDER,
  CRM_STAGE_LABEL,
} from "@/lib/crmPipeline";
import type {
  CrmPipelineStage,
  CrmQuoteStatus,
  Organization,
  OrgContact,
  CrmQuote,
  CrmContract,
  CrmInvoice,
} from "@prisma/client";
import {
  buildScopeWorkItemsFromScopeSummary,
  normalizeScopeWorkItem,
  parseScopeWorkItemsFromPayload,
  syncPilotWorkItemsFromScopeSummary,
} from "@/lib/crmQuoteScopeWorkItems";
import { summarizeScopeForQuote } from "@/lib/crmQuoteDefaults";
import { QUOTE_STANDARD_TERMS_TEXT, QUOTE_STANDARD_TERMS_VERSION } from "@/lib/quoteStandardTerms";

type OrgResponse = {
  organization: Organization & {
    org_contacts: OrgContact[];
    assessments: Array<{
      id: string;
      name: string;
      status: string;
      created_at: Date;
      locked_at: Date | null;
      Participant: Array<{ email: string | null }>;
    }>;
    crm_quotes: Array<Pick<CrmQuote, "id" | "status" | "total_cents" | "updated_at" | "assessment_id">>;
    crm_contracts: CrmContract[];
    crm_invoices: CrmInvoice[];
    _count: { assessments: number; org_contacts: number };
  };
  links: {
    executiveInsightsAssessmentId: string | null;
    projectScope: { assessmentId: string; version: number } | null;
  };
  alerts: { followUpOverdue: boolean; overdueInvoices: number };
  dashboard: {
    kpis: {
      activeProjects: number;
      projectsAtRisk: number;
      projectsDueSoon: number;
      avgCompletionPct: number;
      overdueInvoices: number;
    };
    deliveryUpdates: Array<{
      id: string;
      status_label: string;
      why_text: string | null;
      created_at: string;
      author_email: string | null;
      is_customer_visible: boolean;
      sprint_title: string;
      sprint_status: string;
    }>;
  };
};

function fmtMoney(cents: number | null | undefined) {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function normalizeLookupText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const QUOTE_STATUS_ORDER: CrmQuoteStatus[] = [
  "DRAFT",
  "SENT",
  "ACTIVE",
  "APPROVED",
  "CLOSED_WON",
  "CLOSED_LOST",
];

const QUOTE_PAYMENT_TERMS_OPTIONS = [
  "100% of fees are due with an executed MSA and prior to commencement of work.",
  "50% of the total fees are due with an executed MSA. The remaining 50% is due upon delivery of the agreed scope.",
  "40% of the total fees are due with an executed MSA, 30% is due at the agreed project midpoint or milestone completion, and the remaining 30% is due upon final delivery.",
  "Fees are billed monthly in advance and are due on the first day of each billing period unless otherwise stated in this Quote.",
  "The monthly retainer fee is billed in advance and includes the hours or services stated in this Quote. Additional hours or out-of-scope work will be billed at the agreed rate.",
  "Fees will be invoiced weekly based on actual services performed and are due within fifteen (15) days of invoice date.",
] as const;

function quoteStatusLabel(status: CrmQuoteStatus) {
  if (status === "CLOSED_WON") return "Closed Won";
  if (status === "CLOSED_LOST") return "Closed Lost";
  const lower = status.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

type PriceBookRow = {
  sku: string;
  description: string;
  engagement_name: string;
  company_tier: string;
  base_price_cents: number;
  min_price_cents: number;
  max_price_cents: number;
  hourly_rate_base_cents: number;
  hourly_rate_min_cents: number;
  hourly_rate_max_cents: number;
  adhoc_hourly_rate_cents: number;
  estimated_hours: number;
  timeline: string;
};

type ExpandedProjectDraft = {
  name: string;
  timelineLabel: string;
  costBand: string;
  priority: number;
  deliverablesText: string;
  summary: string;
  projectedToolsText: string;
};

function toPriceBookRow(raw: unknown): PriceBookRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const engagement = String(r.engagement_name ?? r["Engagement Name"] ?? "").trim();
  if (!engagement) return null;
  const tier = String(r.company_tier ?? r["Company Tier"] ?? "").trim() || "All";
  return {
    sku: String(r.sku ?? ""),
    description: String(r.description ?? r.Description ?? ""),
    engagement_name: engagement,
    company_tier: tier,
    base_price_cents: typeof r.base_price_cents === "number" ? r.base_price_cents : 0,
    min_price_cents: typeof r.min_price_cents === "number" ? r.min_price_cents : 0,
    max_price_cents: typeof r.max_price_cents === "number" ? r.max_price_cents : 0,
    hourly_rate_base_cents: typeof r.hourly_rate_base_cents === "number" ? r.hourly_rate_base_cents : 0,
    hourly_rate_min_cents: typeof r.hourly_rate_min_cents === "number" ? r.hourly_rate_min_cents : 0,
    hourly_rate_max_cents: typeof r.hourly_rate_max_cents === "number" ? r.hourly_rate_max_cents : 0,
    adhoc_hourly_rate_cents:
      typeof r.adhoc_hourly_rate_cents === "number"
        ? r.adhoc_hourly_rate_cents
        : typeof r.hourly_rate_adhoc_cents === "number"
          ? r.hourly_rate_adhoc_cents
          : 0,
    estimated_hours: typeof r.estimated_hours === "number" && Number.isFinite(r.estimated_hours) ? r.estimated_hours : 0,
    timeline: String(r.timeline ?? ""),
  };
}

export default function CrmOrganizationClient({
  organizationId,
  view = "overview",
}: {
  organizationId: string;
  view?: "overview" | "quotes";
}) {
  const [data, setData] = useState<OrgResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [followUp, setFollowUp] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [legalBusinessName, setLegalBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [stateOfIncorporation, setStateOfIncorporation] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactTitle, setPrimaryContactTitle] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [billingContactName, setBillingContactName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [contextNotesBusiness, setContextNotesBusiness] = useState("");
  const [companyTechStack, setCompanyTechStack] = useState("");
  const [companyIntegrations, setCompanyIntegrations] = useState("");
  const [companyProcesses, setCompanyProcesses] = useState("");
  const [workflowMapSummary, setWorkflowMapSummary] = useState("");
  const [workflowMapUpdatedAt, setWorkflowMapUpdatedAt] = useState<string | null>(null);
  const [generatingWorkflowMap, setGeneratingWorkflowMap] = useState(false);

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactTitle, setContactTitle] = useState("");

  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [quote, setQuote] = useState<CrmQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [coverDraft, setCoverDraft] = useState("");
  const [termsDraft, setTermsDraft] = useState("");
  const [paymentTermsDraft, setPaymentTermsDraft] = useState("");
  const [validUntilDraft, setValidUntilDraft] = useState("");

  const [contractTitle, setContractTitle] = useState("");
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [invoiceCents, setInvoiceCents] = useState("");
  const [invoiceDue, setInvoiceDue] = useState("");
  const [priceBookCatalogRows, setPriceBookCatalogRows] = useState<PriceBookRow[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [expandedProjectIndex, setExpandedProjectIndex] = useState<number | null>(null);
  const [expandedProjectDraft, setExpandedProjectDraft] = useState<ExpandedProjectDraft | null>(null);
  const [expandedProjectDirty, setExpandedProjectDirty] = useState(false);
  const quoteEditorRef = useRef<HTMLElement | null>(null);
  const projectSummaryRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const projectDeliverablesRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const expandedSummaryRef = useRef<HTMLTextAreaElement | null>(null);
  const expandedDeliverablesRef = useRef<HTMLTextAreaElement | null>(null);

    const loadOrg = useCallback(async () => {
    setLoadErr(null);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}`, { credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load account");
      setData(json as OrgResponse);
      const o = (json as OrgResponse).organization;
      setFollowUp(
        o.crm_next_follow_up_at ? new Date(o.crm_next_follow_up_at).toISOString().slice(0, 16) : ""
      );
      setInternalNotes(o.crm_internal_notes ?? "");
      setLegalBusinessName(o.legal_name ?? "");
      setBusinessAddress(o.legal_address ?? "");
      setStateOfIncorporation(o.state_of_incorporation ?? "");
      setPrimaryContactName(o.primary_contact_name ?? "");
      setPrimaryContactTitle(o.primary_contact_title ?? "");
      setPrimaryContactEmail(o.primary_contact_email ?? "");
      setPrimaryContactPhone(o.primary_contact_phone ?? "");
      setBillingContactName(o.billing_contact_name ?? "");
      setBillingEmail(o.billing_email ?? "");
      setPaymentMethod(o.payment_method ?? "");
      setContextNotesBusiness(o.context_notes ?? "");
      setCompanyTechStack((o as unknown as { tech_stack_notes?: string | null }).tech_stack_notes ?? "");
      setCompanyIntegrations((o as unknown as { integration_notes?: string | null }).integration_notes ?? "");
      setCompanyProcesses((o as unknown as { process_workflow_notes?: string | null }).process_workflow_notes ?? "");
      setWorkflowMapSummary((o as unknown as { workflow_map_ai_summary?: string | null }).workflow_map_ai_summary ?? "");
      setWorkflowMapUpdatedAt(
        (o as unknown as { workflow_map_ai_updated_at?: string | null }).workflow_map_ai_updated_at ?? null
      );
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : "Load failed");
    }
  }, [organizationId]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const loadCurrentPriceBook = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/crm/price-book", { credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.price_books) return;
      const current = (Array.isArray(json.price_books) ? json.price_books : []).find(
        (b: Record<string, unknown>) => b?.is_current === true
      ) as Record<string, unknown> | undefined;
      const rowsRaw = Array.isArray(current?.line_items) ? current!.line_items : [];
      const rows = rowsRaw.map(toPriceBookRow).filter((x): x is PriceBookRow => x !== null);
      setPriceBookCatalogRows(rows);
    } catch {
      // best-effort catalog load for pricing lookups
    }
  }, []);

  useEffect(() => {
    void loadCurrentPriceBook();
    const onFocus = () => void loadCurrentPriceBook();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadCurrentPriceBook]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/branding/current", { credentials: "include" });
        const json = await res.json().catch(() => null);
        if (!cancelled) setLogoUrl(typeof json?.logo_data_url === "string" ? json.logo_data_url : null);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data?.organization.crm_quotes?.length) {
      setSelectedQuoteId(null);
      setQuote(null);
      return;
    }
    const first = data.organization.crm_quotes[0].id;
    if (!selectedQuoteId || !data.organization.crm_quotes.some((q) => q.id === selectedQuoteId)) {
      setSelectedQuoteId(first);
    }
  }, [data, selectedQuoteId]);

  useEffect(() => {
    if (!selectedQuoteId) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setQuoteErr(null);
      try {
        const res = await fetch(`/api/admin/crm/quotes/${selectedQuoteId}`, { credentials: "include" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Quote load failed");
        if (!cancelled) setQuote(json.quote as CrmQuote);
      } catch (e: unknown) {
        if (!cancelled) setQuoteErr(e instanceof Error ? e.message : "Quote load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedQuoteId]);

  const latestAssessment = data?.organization.assessments[0] ?? null;
  const latestAssessmentId = latestAssessment?.id ?? null;
  const latestAssessmentEmails = (latestAssessment?.Participant ?? [])
    .map((p) => p.email ?? "")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const latestAssessmentLocked =
    !latestAssessment || Boolean(latestAssessment.locked_at) || latestAssessment.status === "CLOSED";

  const payload = useMemo(() => {
    const raw = quote?.quote_payload;
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  }, [quote]);

  useEffect(() => {
    setCoverDraft(String(payload.coverNarrative ?? ""));
    setTermsDraft(String(payload.terms ?? ""));
    setPaymentTermsDraft(
      typeof payload.paymentTerms === "string" ? payload.paymentTerms : QUOTE_PAYMENT_TERMS_OPTIONS[0]
    );
    setValidUntilDraft(quote?.valid_until ? new Date(quote.valid_until).toISOString().slice(0, 10) : "");
  }, [quote?.id, quote?.valid_until, payload.coverNarrative, payload.terms, payload.paymentTerms]);

  async function patchOrg(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Save failed");
      await loadOrg();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStage(stage: CrmPipelineStage) {
    await patchOrg({ crm_pipeline_stage: stage });
  }

  async function saveCrmNotes() {
    await patchOrg({
      crm_internal_notes: internalNotes.trim() || null,
      crm_next_follow_up_at: followUp.trim() ? new Date(followUp).toISOString() : null,
    });
  }

  async function saveBusinessInfo() {
    await patchOrg({
      legal_name: legalBusinessName.trim() || null,
      legal_address: businessAddress.trim() || null,
      state_of_incorporation: stateOfIncorporation.trim() || null,
      primary_contact_name: primaryContactName.trim() || null,
      primary_contact_title: primaryContactTitle.trim() || null,
      primary_contact_email: primaryContactEmail.trim() || null,
      primary_contact_phone: primaryContactPhone.trim() || null,
      billing_contact_name: billingContactName.trim() || null,
      billing_email: billingEmail.trim() || null,
      payment_method: paymentMethod.trim() || null,
      context_notes: contextNotesBusiness.trim() || null,
      tech_stack_notes: companyTechStack.trim() || null,
      integration_notes: companyIntegrations.trim() || null,
      process_workflow_notes: companyProcesses.trim() || null,
    });
  }

  async function generateWorkflowMap() {
    setGeneratingWorkflowMap(true);
    try {
      await patchOrg({
        context_notes: contextNotesBusiness.trim() || null,
        tech_stack_notes: companyTechStack.trim() || null,
        integration_notes: companyIntegrations.trim() || null,
        process_workflow_notes: companyProcesses.trim() || null,
      });
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/workflow-map/generate`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to generate workflow map");
      setWorkflowMapSummary(String(json?.summary ?? ""));
      setWorkflowMapUpdatedAt(
        typeof json?.updated_at === "string" ? json.updated_at : json?.updated_at ? String(json.updated_at) : null
      );
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to generate workflow map");
    } finally {
      setGeneratingWorkflowMap(false);
    }
  }

  async function addContact() {
    if (!contactName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/contacts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contactName.trim(),
          email: contactEmail.trim() || undefined,
          title: contactTitle.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to add contact");
      setContactName("");
      setContactEmail("");
      setContactTitle("");
      await loadOrg();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createQuote() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${organizationId}/quotes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Quote create failed");
      await loadOrg();
      if (json.quote?.id) setSelectedQuoteId(json.quote.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Quote create failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncQuoteToNewDraftFromProjects() {
    setBusy(true);
    setQuoteErr(null);
    try {
      const createRes = await fetch(`/api/admin/crm/organizations/${organizationId}/quotes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const createJson = await createRes.json().catch(() => null);
      if (!createRes.ok || !createJson?.quote?.id) {
        throw new Error(createJson?.error || "Failed to create draft quote");
      }

      const newQuoteId = createJson.quote.id as string;
      const nextPayload = {
        ...payload,
        scopeSummary: {
          executiveMemo: scopeSummaryForWork?.executiveMemo ?? "",
          projects: scopeProjects,
        },
      };
      const patchRes = await fetch(`/api/admin/crm/quotes/${newQuoteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_payload: nextPayload, status: "DRAFT" }),
      });
      const patchJson = await patchRes.json().catch(() => null);
      if (!patchRes.ok) {
        throw new Error(patchJson?.error || "Failed to sync projects into new draft");
      }

      await loadOrg();
      openQuoteFromLibrary(newQuoteId);
    } catch (e: unknown) {
      setQuoteErr(e instanceof Error ? e.message : "Sync quote failed");
    } finally {
      setBusy(false);
    }
  }

  function openQuoteFromLibrary(id: string) {
    setQuoteErr(null);
    setSelectedQuoteId(id);
    setTimeout(() => {
      quoteEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function saveQuote(nextPayload: Record<string, unknown>, extra?: Record<string, unknown>) {
    if (!selectedQuoteId) return;
    setBusy(true);
    setQuoteErr(null);
    try {
      const res = await fetch(`/api/admin/crm/quotes/${selectedQuoteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_payload: nextPayload, ...extra }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Quote save failed");
      setQuote(json.quote as CrmQuote);
      await loadOrg();
    } catch (e: unknown) {
      setQuoteErr(e instanceof Error ? e.message : "Quote save failed");
    } finally {
      setBusy(false);
    }
  }

  async function resyncQuoteFromScope() {
    if (!selectedQuoteId) return;
    setBusy(true);
    setQuoteErr(null);
    try {
      const res = await fetch(`/api/admin/crm/quotes/${selectedQuoteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resync_from_scope: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Resync failed");
      setQuote(json.quote as CrmQuote);
      await loadOrg();
    } catch (e: unknown) {
      setQuoteErr(e instanceof Error ? e.message : "Resync failed");
    } finally {
      setBusy(false);
    }
  }

  const scopeSummaryForWork =
    payload.scopeSummary && typeof payload.scopeSummary === "object"
      ? (payload.scopeSummary as {
          executiveMemo?: string;
          projects?: Array<{
            name?: string;
            summary?: string;
            deliverables?: string[];
            projectedTools?: string[];
            timelineLabel?: string;
            costBand?: string | null;
            objectivesBrief?: string;
            priority?: number | null;
          }>;
        })
      : null;
  const scopeProjects = Array.isArray(scopeSummaryForWork?.projects) ? scopeSummaryForWork.projects : [];
  const projectsLocked = payload.scopeProjectsLocked === true;

  const workItems = useMemo(() => parseScopeWorkItemsFromPayload(payload), [payload]);

  const priceBookRows = useMemo(() => {
    const lines = Array.isArray(payload.priceBookLines) ? payload.priceBookLines : [];
    const rows: PriceBookRow[] = [...priceBookCatalogRows];
    for (const row of lines) {
      const mapped = toPriceBookRow(row);
      if (mapped) rows.push(mapped);
    }
    const deduped: PriceBookRow[] = [];
    for (const row of rows) {
      const key = `${row.engagement_name}::${row.company_tier}`.toLowerCase();
      if (deduped.some((d) => `${d.engagement_name}::${d.company_tier}`.toLowerCase() === key)) continue;
      deduped.push(row);
    }
    return deduped;
  }, [payload.priceBookLines, priceBookCatalogRows]);

  const engagementOptions = useMemo(() => {
    const out: string[] = [];
    for (const r of priceBookRows) {
      if (!out.includes(r.engagement_name)) out.push(r.engagement_name);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [priceBookRows]);

  const tierOptions = useMemo(() => {
    const out: string[] = [];
    for (const r of priceBookRows) {
      if (!out.includes(r.company_tier)) out.push(r.company_tier);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [priceBookRows]);

  const topCompanyTier =
    payload.pricingDefaults &&
    typeof payload.pricingDefaults === "object" &&
    typeof (payload.pricingDefaults as Record<string, unknown>).companyTier === "string"
      ? String((payload.pricingDefaults as Record<string, unknown>).companyTier)
      : "";

  function updateWorkItem(index: number, patch: Record<string, unknown>) {
    const items = parseScopeWorkItemsFromPayload(payload);
    const current = items[index];
    if (!current) return;
    const next = [...items];
    next[index] = normalizeScopeWorkItem({ ...current, ...patch, id: current.id }, index);
    void saveScopePricingItems(next);
  }

  function getPriceBookRowForItem(item: ReturnType<typeof parseScopeWorkItemsFromPayload>[number]) {
    if (!item.engagementName) return null;
    const target = normalizeLookupText(item.engagementName);
    const tier = item.companyTierOverride || topCompanyTier || "";
    const exact = priceBookRows.find(
      (r) =>
        normalizeLookupText(r.engagement_name) === target &&
        (tier ? r.company_tier.toLowerCase() === tier.toLowerCase() : true)
    );
    if (exact) return exact;
    const fuzzy = priceBookRows.find(
      (r) =>
        (normalizeLookupText(r.engagement_name).includes(target) ||
          target.includes(normalizeLookupText(r.engagement_name))) &&
        (tier ? r.company_tier.toLowerCase() === tier.toLowerCase() : true)
    );
    if (fuzzy) return fuzzy;
    const all = priceBookRows.find(
      (r) =>
        normalizeLookupText(r.engagement_name) === target &&
        (r.company_tier.toLowerCase() === "all" || r.company_tier.toLowerCase() === "default")
    );
    if (all) return all;
    return (
      priceBookRows.find(
        (r) =>
          normalizeLookupText(r.engagement_name).includes(target) ||
          target.includes(normalizeLookupText(r.engagement_name))
      ) ?? null
    );
  }

  function getUnitPriceCentsForItem(item: ReturnType<typeof parseScopeWorkItemsFromPayload>[number]) {
    const row = getPriceBookRowForItem(item);
    if (!row) return 0;
    const selection = item.pricingSelection;
    if (selection === "MIN_PRICE") return row.min_price_cents || row.base_price_cents || 0;
    if (selection === "MAX_PRICE") return row.max_price_cents || row.base_price_cents || 0;
    if (selection === "HOURLY_RATE_BASE")
      return row.hourly_rate_base_cents || row.adhoc_hourly_rate_cents || 0;
    if (selection === "HOURLY_RATE_MIN") return row.hourly_rate_min_cents || 0;
    if (selection === "HOURLY_RATE_MAX") return row.hourly_rate_max_cents || 0;
    return row.base_price_cents || 0;
  }

  function getBuildDefaultsForEngagement(engagementName: string | null | undefined, tierOverride?: string | null) {
    if (!engagementName) return { buildHours: null as number | null, buildTime: null as string | null };
    const target = normalizeLookupText(engagementName);
    const tier = (tierOverride || topCompanyTier || "").toLowerCase();
    const row =
      priceBookRows.find(
        (r) =>
          normalizeLookupText(r.engagement_name) === target &&
          (!tier || r.company_tier.toLowerCase() === tier)
      ) ??
      priceBookRows.find((r) => normalizeLookupText(r.engagement_name) === target) ??
      null;
    if (!row) return { buildHours: null, buildTime: null };
    return {
      buildHours: row.estimated_hours > 0 ? row.estimated_hours : null,
      buildTime: row.timeline.trim() || null,
    };
  }

  function getLineFinalCents(item: ReturnType<typeof parseScopeWorkItemsFromPayload>[number]) {
    const unit = getUnitPriceCentsForItem(item);
    const qty = Math.max(0, item.quantity || 0);
    const subtotal = Math.round(unit * qty);
    const discount = Math.max(0, Math.min(100, item.discountPct || 0));
    return Math.max(0, Math.round(subtotal * (1 - discount / 100)));
  }

  function getLineSubtotalCents(item: ReturnType<typeof parseScopeWorkItemsFromPayload>[number]) {
    const unit = getUnitPriceCentsForItem(item);
    const qty = Math.max(0, item.quantity || 0);
    return Math.max(0, Math.round(unit * qty));
  }

  const pricingSummary = useMemo(() => {
    const items = parseScopeWorkItemsFromPayload(payload);
    let priceCents = 0;
    let lineTotalCents = 0;
    for (const item of items) {
      if (!item.engagementName) continue;
      const subtotal = getLineSubtotalCents(item);
      const final = getLineFinalCents(item);
      priceCents += subtotal;
      lineTotalCents += final;
    }
    const overallDiscountPctRaw = payload.quoteDiscountPct;
    const overallDiscountPct =
      typeof overallDiscountPctRaw === "number" && Number.isFinite(overallDiscountPctRaw)
        ? Math.max(0, Math.min(100, overallDiscountPctRaw))
        : 0;
    const overallDiscountCents = Math.max(0, Math.round(lineTotalCents * (overallDiscountPct / 100)));
    const totalCents = Math.max(0, lineTotalCents - overallDiscountCents);
    return {
      priceCents,
      lineDiscountCents: Math.max(0, priceCents - lineTotalCents),
      overallDiscountPct,
      overallDiscountCents,
      discountCents: Math.max(0, priceCents - totalCents),
      totalCents,
    };
  }, [payload, topCompanyTier, priceBookRows]);

  function buildCustomLinesFromWorkItems(items: ReturnType<typeof parseScopeWorkItemsFromPayload>) {
    return items
      .map((item) => {
        const finalCents = getLineFinalCents(item);
        if (!item.engagementName || finalCents <= 0) return null;
        const qty = Math.max(0, item.quantity || 0);
        if (qty <= 0) return null;
        const modelLabel = item.pricingModel === "HOURLY" ? "Hourly" : "Project";
        const perUnitFinal = Math.max(0, Math.round(finalCents / qty));
        return {
          description: `${item.engagementName} — ${modelLabel}${item.buildHours ? ` • Build ${item.buildHours}h` : ""}${item.buildTime ? ` • ${item.buildTime}` : ""}`,
          quantity: qty,
          unit_price_cents: perUnitFinal,
          build_hours: item.buildHours,
          build_time: item.buildTime,
        };
      })
      .filter(
        (
          x
        ): x is {
          description: string;
          quantity: number;
          unit_price_cents: number;
          build_hours: number | null;
          build_time: string | null;
        } => x !== null
      );
  }

  async function saveScopePricingItems(items: ReturnType<typeof parseScopeWorkItemsFromPayload>) {
    const neutralPriceBookLines = (Array.isArray(payload.priceBookLines) ? payload.priceBookLines : []).map((row) => {
      if (!row || typeof row !== "object") return row;
      return { ...(row as Record<string, unknown>), selected: false, quantity: 1 };
    });
    const nextPayload = {
      ...payload,
      scopeWorkItems: items,
      customLines: buildCustomLinesFromWorkItems(items),
      priceBookLines: neutralPriceBookLines,
      pricingDefaults: {
        ...(payload.pricingDefaults && typeof payload.pricingDefaults === "object"
          ? (payload.pricingDefaults as Record<string, unknown>)
          : {}),
        companyTier: topCompanyTier || null,
      },
    };
    await saveQuote(nextPayload);
  }

  async function setTopCompanyTier(nextTier: string) {
    const items = parseScopeWorkItemsFromPayload(payload);
    const neutralPriceBookLines = (Array.isArray(payload.priceBookLines) ? payload.priceBookLines : []).map((row) => {
      if (!row || typeof row !== "object") return row;
      return { ...(row as Record<string, unknown>), selected: false, quantity: 1 };
    });
    const nextPayload = {
      ...payload,
      pricingDefaults: {
        ...(payload.pricingDefaults && typeof payload.pricingDefaults === "object"
          ? (payload.pricingDefaults as Record<string, unknown>)
          : {}),
        companyTier: nextTier || null,
      },
      customLines: buildCustomLinesFromWorkItems(items),
      priceBookLines: neutralPriceBookLines,
    };
    await saveQuote(nextPayload);
  }

  function autoMapWorkItemsByTitle() {
    const items = parseScopeWorkItemsFromPayload(payload);
    if (items.length === 0) return;
    const names = engagementOptions;
    const next = items.map((item, idx) => {
      if (item.engagementName) return item;
      const itemText = normalizeLookupText(item.title);
      if (!itemText) return item;
      const match = names.find((name) => {
        const t = normalizeLookupText(name);
        return t && (t.includes(itemText) || itemText.includes(t));
      });
      if (!match) return item;
      return normalizeScopeWorkItem({ ...item, engagementName: match }, idx);
    });
    void saveScopePricingItems(next);
  }

  function addWorkItemRow() {
    const items = parseScopeWorkItemsFromPayload(payload);
    const row = normalizeScopeWorkItem(
      {
        title: "New scope line",
        detail: "",
        kind: "CUSTOM",
        sourceProjectIndex: null,
        estimatedHours: null,
        billQuantity: 1,
        linkedSku: null,
        notes: "",
      },
      items.length
    );
    void saveScopePricingItems([...items, row]);
  }

  function removeWorkItemRow(index: number) {
    const items = parseScopeWorkItemsFromPayload(payload).filter((_, i) => i !== index);
    void saveScopePricingItems(items);
  }

  function initWorkItemsFromScopeSummary() {
    if (!scopeSummaryForWork) return;
    const items = buildScopeWorkItemsFromScopeSummary(scopeSummaryForWork);
    void saveScopePricingItems(items);
  }

  async function refreshSimplifiedReadoutFromSnapshot() {
    if (!quote) return;
    const snap = quote.project_scope_snapshot;
    if (snap === null || typeof snap !== "object") {
      setQuoteErr(
        "No project scope snapshot on this quote. Click “Re-sync from latest scope” (or create a new quote) first."
      );
      return;
    }
    setQuoteErr(null);
    const nextSummary = summarizeScopeForQuote(snap);
    await saveQuote({ ...payload, scopeSummary: nextSummary });
  }

  function syncPilotRowsToReadout() {
    if (!scopeSummaryForWork?.projects?.length) return;
    const next = syncPilotWorkItemsFromScopeSummary(payload, scopeSummaryForWork);
    void saveQuote(next);
  }

  async function saveScopeProjects(
    nextProjects: Array<{
      name?: string;
      summary?: string;
      deliverables?: string[];
      projectedTools?: string[];
      timelineLabel?: string;
      costBand?: string | null;
      objectivesBrief?: string;
      priority?: number | null;
    }>
  ) {
    const nextScopeSummary = {
      executiveMemo: scopeSummaryForWork?.executiveMemo ?? "",
      projects: nextProjects,
    };
    await saveQuote({ ...payload, scopeSummary: nextScopeSummary });
  }

  function addScopeProjectCard() {
    if (projectsLocked) return;
    const next = [
      ...scopeProjects,
      {
        name: "New project",
        summary: "",
        deliverables: [],
        projectedTools: [],
        timelineLabel: "TBD",
        costBand: "TBD",
        objectivesBrief: "",
        priority: scopeProjects.length + 1,
      },
    ];
    void saveScopeProjects(next);
  }

  function deleteScopeProjectCard(index: number) {
    if (projectsLocked) return;
    const next = scopeProjects.filter((_, i) => i !== index);
    void saveScopeProjects(next);
  }

  function updateScopeProjectCard(
    index: number,
    patch: Partial<{
      name?: string;
      summary?: string;
      deliverables?: string[];
      projectedTools?: string[];
      timelineLabel?: string;
      costBand?: string | null;
      objectivesBrief?: string;
      priority?: number | null;
    }>
  ) {
    if (projectsLocked) return;
    const current = scopeProjects[index];
    if (!current) return;
    const next = [...scopeProjects];
    next[index] = {
      ...current,
      ...patch,
    };
    void saveScopeProjects(next);
  }

  function openExpandedProjectEditor(index: number) {
    const current = scopeProjects[index];
    if (!current) return;
    setExpandedProjectIndex(index);
    setExpandedProjectDraft({
      name: current.name ?? "",
      timelineLabel: current.timelineLabel ?? "",
      costBand: current.costBand ?? "",
      priority: current.priority ?? index + 1,
      deliverablesText: Array.isArray(current.deliverables) ? current.deliverables.join("\n") : "",
      summary: current.summary ?? "",
      projectedToolsText: Array.isArray(current.projectedTools) ? current.projectedTools.join("\n") : "",
    });
    setExpandedProjectDirty(false);
  }

  function closeExpandedProjectEditor() {
    setExpandedProjectIndex(null);
    setExpandedProjectDraft(null);
    setExpandedProjectDirty(false);
  }

  function saveExpandedProjectEditor() {
    if (projectsLocked || expandedProjectIndex === null || !expandedProjectDraft) {
      closeExpandedProjectEditor();
      return;
    }
    updateScopeProjectCard(expandedProjectIndex, {
      name: expandedProjectDraft.name,
      timelineLabel: expandedProjectDraft.timelineLabel,
      costBand: expandedProjectDraft.costBand,
      priority: expandedProjectDraft.priority,
      deliverables: expandedProjectDraft.deliverablesText
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
      summary: expandedProjectDraft.summary,
      projectedTools: expandedProjectDraft.projectedToolsText
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
    });
    closeExpandedProjectEditor();
  }

  function applyProjectFormat(
    index: number,
    field: "summary" | "deliverables",
    mode: "bold" | "italic" | "bullet" | "number",
    source: "inline" | "expanded" = "inline"
  ) {
    if (projectsLocked) return;
    const el =
      source === "expanded"
        ? field === "summary"
          ? expandedSummaryRef.current
          : expandedDeliverablesRef.current
        : field === "summary"
          ? projectSummaryRefs.current[index]
          : projectDeliverablesRefs.current[index];
    if (!el) return;
    const text = el.value || "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const selected = text.slice(start, end);
    let replacement = selected;
    let nextStart = start;
    let nextEnd = end;

    if (mode === "bold") {
      replacement = `**${selected || "text"}**`;
      nextStart = start + 2;
      nextEnd = nextStart + (selected || "text").length;
    } else if (mode === "italic") {
      replacement = `*${selected || "text"}*`;
      nextStart = start + 1;
      nextEnd = nextStart + (selected || "text").length;
    } else if (mode === "bullet") {
      const src = (selected || "item").split("\n");
      replacement = src.map((line) => (line.trim() ? `- ${line}` : "- ")).join("\n");
      nextEnd = start + replacement.length;
    } else if (mode === "number") {
      const src = (selected || "item").split("\n");
      replacement = src.map((line, i) => `${i + 1}. ${line || ""}`).join("\n");
      nextEnd = start + replacement.length;
    }

    const nextText = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
    if (source === "expanded") {
      setExpandedProjectDraft((prev) => {
        if (!prev) return prev;
        return field === "summary" ? { ...prev, summary: nextText } : { ...prev, deliverablesText: nextText };
      });
      setExpandedProjectDirty(true);
    } else if (field === "summary") {
      updateScopeProjectCard(index, { summary: nextText });
    } else {
      updateScopeProjectCard(index, {
        deliverables: nextText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      });
    }
    requestAnimationFrame(() => {
      const ref =
        source === "expanded"
          ? field === "summary"
            ? expandedSummaryRef.current
            : expandedDeliverablesRef.current
          : field === "summary"
            ? projectSummaryRefs.current[index]
            : projectDeliverablesRefs.current[index];
      if (!ref) return;
      ref.focus();
      ref.setSelectionRange(nextStart, nextEnd);
    });
  }

  async function saveQuoteAsActiveForPm() {
    if (!selectedQuoteId) return;
    const nextPayload = {
      ...payload,
      pm: {
        ...(payload.pm && typeof payload.pm === "object"
          ? (payload.pm as Record<string, unknown>)
          : {}),
        activeForPm: true,
      },
    };
    await saveQuote(nextPayload, { status: "ACTIVE" });
  }

  async function setProjectsLocked(nextLocked: boolean) {
    const nextPayload = {
      ...payload,
      scopeProjectsLocked: nextLocked,
      scopeProjectsLockedAt: nextLocked ? new Date().toISOString() : null,
    };
    await saveQuote(nextPayload);
  }

  if (loadErr) {
    return (
      <div className="p-8 font-bold" style={{ color: BRAND.danger }}>
        {loadErr}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 font-semibold" style={{ color: BRAND.muted }}>
        Loading account…
      </div>
    );
  }

  const org = data.organization;
  const execId = data.links.executiveInsightsAssessmentId;
  const scope = data.links.projectScope;
  const overdueFollow = data.alerts.followUpOverdue;
  const stage = org.crm_pipeline_stage;
  const stepIdx = CRM_PIPELINE_ORDER.indexOf(stage);

  const contacts = org.org_contacts.filter((c) => !c.is_archived);
  const topActionButtonStyle = adminPremiumActionStyle;

  return (
    <AdminShell>
        <header className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: BRAND.border }}>
          <div>
            <Link href="/admin/crm" className="text-xs font-black uppercase tracking-wider hover:underline" style={{ color: BRAND.cyan }}>
              ← CRM hub
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight" style={{ color: BRAND.dark }}>
              {org.name}
            </h1>
            <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Client profile • {org._count.assessments} assessment(s) • {contacts.length} contact(s)
            </p>
          </div>
          <ActionRail>
            {view === "quotes" ? (
              <Link
                href={`/admin/crm/organizations/${org.id}`}
                className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
                style={topActionButtonStyle}
              >
                ← Back to Organization Account
              </Link>
            ) : null}
            {latestAssessmentId ? (
              <Link
                href={`/admin/assessments/${latestAssessmentId}`}
                className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
                style={topActionButtonStyle}
              >
                Manage Assessment
              </Link>
            ) : null}
            {latestAssessmentId ? (
              <Link
                href={`/admin/assessments/${latestAssessmentId}/dashboard`}
                className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
                style={topActionButtonStyle}
              >
                Reporting Dashboard
              </Link>
            ) : null}
            {latestAssessmentId ? (
              <Link
                href={`/customer/dashboard?assessmentId=${latestAssessmentId}&preview=1`}
                className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
                style={topActionButtonStyle}
              >
                Customer User Admin
              </Link>
            ) : null}
            {latestAssessmentId ? (
              <SendAssessmentButton
                assessmentId={latestAssessmentId}
                assessmentLocked={latestAssessmentLocked}
                participantEmails={latestAssessmentEmails}
              />
            ) : null}
            <Link
              href={`/admin/crm/organizations/${org.id}/quotes`}
              className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
              style={topActionButtonStyle}
            >
              Open Quote Workspace
            </Link>
            <Link
              href={`/admin/crm/organizations/${org.id}/projects`}
              className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
              style={topActionButtonStyle}
            >
              Open PM Workspace
            </Link>
            <Link
              href={`/admin/crm/organizations/${org.id}/msa`}
              className="rounded-2xl px-4 py-2 text-sm font-black tracking-tight transition hover:-translate-y-[1px]"
              style={topActionButtonStyle}
            >
              Open MSA Workspace
            </Link>
          </ActionRail>
        </header>

        <SectionCard
          title="Organization Command Center"
          subtitle="Actionable delivery and commercial health in one place."
        >
          <div className="flex flex-wrap gap-2">
            <MetricChip label="Active projects" value={String(data.dashboard.kpis.activeProjects)} />
            <MetricChip label="At risk" value={String(data.dashboard.kpis.projectsAtRisk)} />
            <MetricChip label="Due this week" value={String(data.dashboard.kpis.projectsDueSoon)} />
            <MetricChip label="Avg completion" value={`${data.dashboard.kpis.avgCompletionPct}%`} />
            <MetricChip label="Overdue invoices" value={String(data.dashboard.kpis.overdueInvoices)} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border bg-white p-3" style={{ borderColor: BRAND.border }}>
              <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                Next best actions
              </div>
              <ul className="mt-2 space-y-1 text-sm font-semibold" style={{ color: BRAND.dark }}>
                {data.dashboard.kpis.projectsAtRisk > 0 ? (
                  <li>Review at-risk project statuses and update mitigation plans.</li>
                ) : null}
                {data.dashboard.kpis.projectsDueSoon > 0 ? (
                  <li>Confirm delivery timelines for projects due in the next 7 days.</li>
                ) : null}
                {data.alerts.overdueInvoices > 0 ? <li>Follow up on past-due invoices from this account.</li> : null}
                {data.dashboard.kpis.projectsAtRisk === 0 &&
                data.dashboard.kpis.projectsDueSoon === 0 &&
                data.alerts.overdueInvoices === 0 ? (
                  <li>All core account workflows are currently healthy.</li>
                ) : null}
              </ul>
            </div>
            <div className="rounded-xl border bg-white p-3" style={{ borderColor: BRAND.border }}>
              <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                Delivery timeline
              </div>
              <div className="mt-2 max-h-40 space-y-2 overflow-auto">
                {data.dashboard.deliveryUpdates.slice(0, 6).map((u) => (
                  <div key={u.id} className="rounded-lg border p-2 text-xs" style={{ borderColor: BRAND.border }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-black" style={{ color: BRAND.dark }}>
                        {u.status_label}
                      </div>
                      <StatusBadge label={u.sprint_status.replaceAll("_", " ")} />
                    </div>
                    <div className="mt-1 font-semibold" style={{ color: BRAND.muted }}>
                      {u.sprint_title} • {new Date(u.created_at).toLocaleString()}
                    </div>
                    {u.why_text ? (
                      <div className="mt-1 font-semibold" style={{ color: BRAND.dark }}>
                        {u.why_text}
                      </div>
                    ) : null}
                  </div>
                ))}
                {data.dashboard.deliveryUpdates.length === 0 ? (
                  <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                    No delivery updates yet.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </SectionCard>

        <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Executive Insights Controls
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Configure participant-facing insights tools from the organization account.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <AdminControlsToggleButton organizationId={org.id} initialEnabled={Boolean(org.show_admin_controls)} />
            <ProjectScopeToggleButton
              organizationId={org.id}
              initialEnabled={Boolean(org.show_project_scope_review)}
            />
          </div>
        </section>

        {(overdueFollow || data.alerts.overdueInvoices > 0) && (
          <div
            className="rounded-2xl border px-4 py-3 text-sm font-bold"
            style={{
              borderColor: BRAND.danger,
              background: "rgba(180, 35, 24, 0.08)",
              color: BRAND.dark,
            }}
          >
            {overdueFollow ? <div>Follow-up date is past due—update the pipeline or set a new date.</div> : null}
            {data.alerts.overdueInvoices > 0 ? (
              <div className="mt-1">This account has {data.alerts.overdueInvoices} overdue invoice(s) in CRM.</div>
            ) : null}
          </div>
        )}

        <section className="rounded-2xl border bg-white/95 p-4 shadow-sm backdrop-blur-sm sm:p-6" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Pipeline status
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {CRM_PIPELINE_ORDER.map((s, i) => {
              const active = i <= stepIdx;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => setStage(s)}
                  className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition disabled:opacity-50"
                  style={{
                    background: active ? BRAND.dark : BRAND.surfaceMuted,
                    color: active ? "#fff" : BRAND.muted,
                    border: `1px solid ${active ? BRAND.dark : BRAND.border}`,
                  }}
                >
                  {CRM_STAGE_LABEL[s]}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Click a stage to update status. Workshops, quotes, and signatures map to the last three steps.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Deliverables
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {execId ? (
                <a
                  href={`/assessments/${execId}/narrative`}
                  className="rounded-xl px-4 py-3 text-sm font-bold text-white"
                  style={{ background: BRAND.cyan }}
                >
                  Open Executive Insights report →
                </a>
              ) : (
                <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                  No narrative yet—complete assessment and generate Executive Insights.
                </div>
              )}
              {scope ? (
                <a
                  href={`/assessments/${scope.assessmentId}/project-scope`}
                  className="rounded-xl border px-4 py-3 text-sm font-bold"
                  style={{ borderColor: BRAND.border, color: BRAND.dark, background: BRAND.surfaceMuted }}
                >
                  Open project scope readout (v{scope.version}) →
                </a>
              ) : (
                <div className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                  Project scope not generated for the latest assessment.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Tracking & internal notes
            </div>
            <label className="mt-3 block text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
              Next follow-up
            </label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
            <label className="mt-3 block text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
              Internal notes
            </label>
            <textarea
              className="mt-1 min-h-[100px] w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded-xl px-4 py-2 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: BRAND.dark }}
              onClick={saveCrmNotes}
            >
              Save tracking
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Client business & billing info
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Legal Business Name"
              value={legalBusinessName}
              onChange={(e) => setLegalBusinessName(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="State of incorporation (optional)"
              value={stateOfIncorporation}
              onChange={(e) => setStateOfIncorporation(e.target.value)}
            />
            <textarea
              className="min-h-[84px] rounded-xl border px-3 py-2 text-sm font-semibold outline-none md:col-span-2"
              style={{ borderColor: BRAND.border }}
              placeholder="Business Address (HQ or billing)"
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Primary contact name"
              value={primaryContactName}
              onChange={(e) => setPrimaryContactName(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Primary contact title"
              value={primaryContactTitle}
              onChange={(e) => setPrimaryContactTitle(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Primary contact email"
              value={primaryContactEmail}
              onChange={(e) => setPrimaryContactEmail(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Primary contact phone (optional)"
              value={primaryContactPhone}
              onChange={(e) => setPrimaryContactPhone(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Billing contact name"
              value={billingContactName}
              onChange={(e) => setBillingContactName(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Billing email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none md:col-span-2"
              style={{ borderColor: BRAND.border }}
              placeholder="Payment method (required before work starts)"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            />
            <textarea
              className="min-h-[84px] rounded-xl border px-3 py-2 text-sm font-semibold outline-none md:col-span-2"
              style={{ borderColor: BRAND.border }}
              placeholder="Context notes (business model, positioning, constraints)"
              value={contextNotesBusiness}
              onChange={(e) => setContextNotesBusiness(e.target.value)}
            />
            <textarea
              className="min-h-[96px] rounded-xl border px-3 py-2 text-sm font-semibold outline-none md:col-span-2"
              style={{ borderColor: BRAND.border }}
              placeholder="Known tech stack (CRM, PM, support, BI, automation tools, custom systems)"
              value={companyTechStack}
              onChange={(e) => setCompanyTechStack(e.target.value)}
            />
            <textarea
              className="min-h-[96px] rounded-xl border px-3 py-2 text-sm font-semibold outline-none md:col-span-2"
              style={{ borderColor: BRAND.border }}
              placeholder="Known integrations (Zapier/Make.com flows, APIs, data syncs, custom connectors)"
              value={companyIntegrations}
              onChange={(e) => setCompanyIntegrations(e.target.value)}
            />
            <textarea
              className="min-h-[96px] rounded-xl border px-3 py-2 text-sm font-semibold outline-none md:col-span-2"
              style={{ borderColor: BRAND.border }}
              placeholder="Known processes and workflows (handoffs, approvals, ticket-to-revenue flow, reporting cadence, operational SOPs)"
              value={companyProcesses}
              onChange={(e) => setCompanyProcesses(e.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || generatingWorkflowMap}
              className="rounded-xl px-4 py-2 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: BRAND.cyan }}
              onClick={generateWorkflowMap}
            >
              {generatingWorkflowMap ? "Generating workflow map…" : "Generate workflow map from notes"}
            </button>
            <Link
              href={`/admin/crm/organizations/${organizationId}/workflow-infographic`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl px-4 py-2 text-sm font-black uppercase tracking-wide text-white"
              style={{ background: BRAND.dark }}
            >
              Generate infographic
            </Link>
            {workflowMapUpdatedAt ? (
              <span className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                Updated {new Date(workflowMapUpdatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          {workflowMapSummary ? (
            <div
              className="mt-3 whitespace-pre-wrap rounded-xl border px-3 py-3 text-sm font-semibold"
              style={{ borderColor: BRAND.border, background: "rgba(23,52,100,0.04)", color: BRAND.text }}
            >
              {workflowMapSummary}
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="mt-3 rounded-xl px-4 py-2 text-sm font-black uppercase tracking-wide text-white disabled:opacity-50"
            style={{ background: BRAND.dark }}
            onClick={saveBusinessInfo}
          >
            Save business info
          </button>
        </section>

        {view === "overview" ? (
          <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  Quotes
                </div>
                <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                  Quote creation and editing now lives in a dedicated workspace for this customer.
                </p>
              </div>
              <Link
                href={`/admin/crm/organizations/${org.id}/quotes`}
                className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white"
                style={{ background: BRAND.dark }}
              >
                Go to quote workspace
              </Link>
            </div>
            {org.crm_quotes.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                      <th className="pb-2 pr-2">Status</th>
                      <th className="pb-2 pr-2">Total</th>
                      <th className="pb-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.crm_quotes.slice(0, 5).map((q) => (
                      <tr key={q.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                        <td className="py-2 pr-2">{q.status}</td>
                        <td className="py-2 pr-2">{fmtMoney(q.total_cents)}</td>
                        <td className="py-2">{new Date(q.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 text-sm font-semibold" style={{ color: BRAND.muted }}>
                No quotes yet.
              </div>
            )}
          </section>
        ) : null}

        {view === "overview" ? (
          <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  Project Management
                </div>
                <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                  Internal sprint tracking workspace with AI status overviews and customer-safe update controls.
                </p>
              </div>
              <Link
                href={`/admin/crm/organizations/${org.id}/projects`}
                className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white"
                style={{ background: BRAND.dark }}
              >
                Open PM workspace
              </Link>
              <Link
                href={`/admin/crm/organizations/${org.id}/msa`}
                className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white"
                style={{ background: BRAND.dark }}
              >
                Open MSA workspace
              </Link>
            </div>
          </section>
        ) : null}

        {view === "quotes" ? (
          <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Contacts
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Used for quote signatory and point-of-contact dropdowns. Add new entries anytime.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Title</th>
                  <th className="pb-2">Email</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                    <td className="py-2 pr-3">{c.name}</td>
                    <td className="py-2 pr-3">{c.title ?? "—"}</td>
                    <td className="py-2">{c.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Name *"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Title"
              value={contactTitle}
              onChange={(e) => setContactTitle(e.target.value)}
            />
            <input
              className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-3 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
            style={{ background: BRAND.cyan }}
            onClick={addContact}
          >
            Add contact
          </button>
          </section>
        ) : null}

        <section
          ref={quoteEditorRef}
          className="rounded-2xl border bg-white/95 p-5 shadow-sm"
          style={{ borderColor: BRAND.border }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                Project scope & quote
              </div>
              <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                Auto-filled from project scope and price book; edit line items and narrative before sending.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50"
                style={{ borderColor: BRAND.border, color: BRAND.dark }}
                onClick={createQuote}
              >
                New quote
              </button>
              <select
                className="rounded-xl border px-3 py-2 text-sm font-bold outline-none"
                style={{ borderColor: BRAND.border, color: BRAND.dark }}
                value={selectedQuoteId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  if (id) openQuoteFromLibrary(id);
                  else setSelectedQuoteId(null);
                }}
              >
                {org.crm_quotes.length === 0 ? <option value="">No quotes yet</option> : null}
                {org.crm_quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {quoteStatusLabel(q.status)} · {fmtMoney(q.total_cents)} · {new Date(q.updated_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {quoteErr ? (
            <div className="mt-3 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: "#fef2f2", color: BRAND.danger }}>
              {quoteErr}
            </div>
          ) : null}

          {view === "quotes" ? (
            <div className="mt-4 rounded-xl border p-3" style={{ borderColor: BRAND.border }}>
              <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                Quote library
              </div>
              <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                All saved quotes and where they are in process.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Total</th>
                      <th className="pb-2 pr-3">Updated</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.crm_quotes.map((q) => (
                      <tr key={q.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                        <td className="py-2 pr-3">{quoteStatusLabel(q.status)}</td>
                        <td className="py-2 pr-3">{fmtMoney(q.total_cents)}</td>
                        <td className="py-2 pr-3">{new Date(q.updated_at).toLocaleString()}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
                              style={{ borderColor: BRAND.border, color: BRAND.dark }}
                              onClick={() => openQuoteFromLibrary(q.id)}
                            >
                              Open
                            </button>
                            <a
                              href={`/admin/crm/quotes/${q.id}/preview`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
                              style={{ borderColor: BRAND.border, color: BRAND.dark }}
                            >
                              View
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {org.crm_quotes.length === 0 ? (
                      <tr>
                        <td className="py-2" colSpan={4} style={{ color: BRAND.muted }}>
                          No quotes yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {quote ? (
            <div
              className="mt-5 rounded-2xl border px-4 py-4"
              style={{ borderColor: BRAND.border, background: "rgba(23, 52, 100, 0.04)" }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.dark }}>
                    Scope readout simplifier
                  </div>
                  <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                    What we will actually do: deliverables, a short scope extract, timeline, and cost band — without the
                    long narrative. This is what feeds quote line descriptions when you create or sync work items.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !quote.project_scope_snapshot}
                    className="rounded-xl border bg-white px-3 py-2 text-xs font-black uppercase disabled:opacity-50"
                    style={{ borderColor: BRAND.border, color: BRAND.dark }}
                    onClick={() => void refreshSimplifiedReadoutFromSnapshot()}
                  >
                    Rebuild readout from scope
                  </button>
                  <button
                    type="button"
                    disabled={busy || projectsLocked}
                    className="rounded-xl border bg-white px-3 py-2 text-xs font-black uppercase disabled:opacity-50"
                    style={{ borderColor: BRAND.border, color: BRAND.dark }}
                    onClick={addScopeProjectCard}
                  >
                    Add project
                  </button>
                  <button
                    type="button"
                    disabled={busy || scopeProjects.length === 0 || projectsLocked}
                    className="rounded-xl border bg-white px-3 py-2 text-xs font-black uppercase disabled:opacity-50"
                    style={{ borderColor: BRAND.border, color: BRAND.dark }}
                    onClick={() => void syncQuoteToNewDraftFromProjects()}
                  >
                    Sync quote (new draft)
                  </button>
                  <button
                    type="button"
                    disabled={busy || scopeProjects.length === 0}
                    className="rounded-xl border bg-white px-3 py-2 text-xs font-black uppercase disabled:opacity-50"
                    style={{ borderColor: BRAND.border, color: BRAND.dark }}
                    onClick={() => void setProjectsLocked(!projectsLocked)}
                  >
                    {projectsLocked ? "Unlock projects" : "Projects locked"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || workItems.length === 0}
                    className="rounded-xl px-3 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                    style={{ background: BRAND.cyan }}
                    onClick={syncPilotRowsToReadout}
                  >
                    Sync pilot rows
                  </button>
                </div>
              </div>

              {scopeSummaryForWork?.executiveMemo ? (
                <p className="mt-4 text-sm font-semibold leading-relaxed" style={{ color: BRAND.text }}>
                  <span className="font-black" style={{ color: BRAND.greyBlue }}>
                    Executive brief:{" "}
                  </span>
                  {scopeSummaryForWork?.executiveMemo}
                </p>
              ) : null}
              <p className="mt-2 text-xs font-semibold" style={{ color: BRAND.muted }}>
                {projectsLocked
                  ? "Projects are locked for client quote + PM handoff. Unlock to edit."
                  : "Projects are editable. Lock when scope is approved for client view and PM handoff."}
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {scopeProjects.map((p, i) => (
                  <div
                    key={`${p.name ?? i}-${i}`}
                    className="rounded-xl border bg-white/90 p-4 shadow-sm"
                    style={{ borderColor: BRAND.border }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <input
                        className="w-full rounded border px-2 py-1 text-sm font-black outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={p.name ?? ""}
                        disabled={projectsLocked}
                        onChange={(e) => updateScopeProjectCard(i, { name: e.target.value })}
                        placeholder={`Initiative ${i + 1}`}
                      />
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        onClick={() => openExpandedProjectEditor(i)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.danger, color: BRAND.danger }}
                        disabled={projectsLocked}
                        onClick={() => deleteScopeProjectCard(i)}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded border px-2 py-1 text-xs font-semibold outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={p.timelineLabel ?? ""}
                        disabled={projectsLocked}
                        onChange={(e) => updateScopeProjectCard(i, { timelineLabel: e.target.value })}
                        placeholder="Timeline (e.g., 12 weeks)"
                      />
                      <input
                        className="rounded border px-2 py-1 text-xs font-semibold outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={p.costBand ?? ""}
                        disabled={projectsLocked}
                        onChange={(e) => updateScopeProjectCard(i, { costBand: e.target.value })}
                        placeholder="Cost band"
                      />
                      <select
                        className="rounded border px-2 py-1 text-xs font-semibold outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={String(p.priority ?? i + 1)}
                        disabled={projectsLocked}
                        onChange={(e) =>
                          updateScopeProjectCard(i, {
                            priority: Number(e.target.value) || i + 1,
                          })
                        }
                      >
                        {Array.from({ length: Math.max(1, scopeProjects.length) }).map((_, idx) => (
                          <option key={idx + 1} value={idx + 1}>
                            Priority {idx + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="mt-2 min-h-[76px] w-full rounded border px-2 py-1 text-xs font-semibold outline-none"
                      style={{ borderColor: BRAND.border }}
                      value={Array.isArray(p.deliverables) ? p.deliverables.join("\n") : ""}
                      disabled={projectsLocked}
                      ref={(el) => {
                        projectDeliverablesRefs.current[i] = el;
                      }}
                      onChange={(e) =>
                        updateScopeProjectCard(i, {
                          deliverables: e.target.value
                            .split("\n")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="One deliverable per line"
                    />
                    <textarea
                      className="mt-2 min-h-[64px] w-full rounded border px-2 py-1 text-xs font-semibold outline-none"
                      style={{ borderColor: BRAND.border }}
                      value={Array.isArray(p.projectedTools) ? p.projectedTools.join("\n") : ""}
                      disabled={projectsLocked}
                      onChange={(e) =>
                        updateScopeProjectCard(i, {
                          projectedTools: e.target.value
                            .split("\n")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Recommended tools (one per line)"
                    />
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "deliverables", "bold")}
                      >
                        Bold
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "deliverables", "italic")}
                      >
                        Italic
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "deliverables", "bullet")}
                      >
                        Bullets
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "deliverables", "number")}
                      >
                        Numbered
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "summary", "bold")}
                      >
                        Bold
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "summary", "italic")}
                      >
                        Italic
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "summary", "bullet")}
                      >
                        Bullets
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => applyProjectFormat(i, "summary", "number")}
                      >
                        Numbered
                      </button>
                    </div>
                    <textarea
                      className="mt-2 min-h-[68px] w-full rounded border px-2 py-1 text-xs font-semibold outline-none"
                      style={{ borderColor: BRAND.border }}
                      value={p.summary ?? ""}
                      disabled={projectsLocked}
                      ref={(el) => {
                        projectSummaryRefs.current[i] = el;
                      }}
                      onChange={(e) => updateScopeProjectCard(i, { summary: e.target.value })}
                      placeholder="Project scope summary"
                    />
                  </div>
                ))}
                {scopeProjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-4 text-sm font-semibold" style={{ borderColor: BRAND.border, color: BRAND.muted }}>
                    No projects yet. Click “Add project” to create one.
                  </div>
                ) : null}
              </div>
              {expandedProjectIndex !== null && expandedProjectDraft ? (
                <div className="fixed inset-0 z-[80] bg-black/35 p-4">
                  <div
                    className="mx-auto h-full max-w-4xl overflow-auto rounded-2xl border bg-white p-5 shadow-2xl"
                    style={{ borderColor: BRAND.border }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-black uppercase tracking-wider" style={{ color: BRAND.dark }}>
                        Edit project scope (full view)
                      </div>
                      <button
                        type="button"
                        className="rounded border px-3 py-1 text-xs font-black uppercase"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        onClick={() => {
                          if (expandedProjectDirty) {
                            const shouldDiscard = window.confirm(
                              "You have unsaved changes. If you click Done without Save, your edits will not be saved. Discard changes?"
                            );
                            if (!shouldDiscard) return;
                          }
                          closeExpandedProjectEditor();
                        }}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="rounded border px-3 py-1 text-xs font-black uppercase text-white"
                        style={{ borderColor: BRAND.dark, background: BRAND.dark }}
                        disabled={projectsLocked}
                        onClick={() => saveExpandedProjectEditor()}
                      >
                        Save
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded border px-2 py-2 text-sm font-black outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={expandedProjectDraft.name}
                        disabled={projectsLocked}
                        onChange={(e) => {
                          setExpandedProjectDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev));
                          setExpandedProjectDirty(true);
                        }}
                        placeholder="Project title"
                      />
                      <input
                        className="rounded border px-2 py-2 text-sm font-semibold outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={expandedProjectDraft.timelineLabel}
                        disabled={projectsLocked}
                        onChange={(e) => {
                          setExpandedProjectDraft((prev) =>
                            prev ? { ...prev, timelineLabel: e.target.value } : prev
                          );
                          setExpandedProjectDirty(true);
                        }}
                        placeholder="Timeline"
                      />
                      <input
                        className="rounded border px-2 py-2 text-sm font-semibold outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={expandedProjectDraft.costBand}
                        disabled={projectsLocked}
                        onChange={(e) => {
                          setExpandedProjectDraft((prev) => (prev ? { ...prev, costBand: e.target.value } : prev));
                          setExpandedProjectDirty(true);
                        }}
                        placeholder="Cost band"
                      />
                      <select
                        className="rounded border px-2 py-2 text-sm font-semibold outline-none"
                        style={{ borderColor: BRAND.border }}
                        value={String(expandedProjectDraft.priority)}
                        disabled={projectsLocked}
                        onChange={(e) => {
                          setExpandedProjectDraft((prev) =>
                            prev ? { ...prev, priority: Number(e.target.value) || prev.priority } : prev
                          );
                          setExpandedProjectDirty(true);
                        }}
                      >
                        {Array.from({ length: Math.max(1, scopeProjects.length) }).map((_, idx) => (
                          <option key={idx + 1} value={idx + 1}>
                            Priority {idx + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className="mt-3 min-h-[180px] w-full rounded border px-2 py-2 text-sm font-semibold outline-none"
                      style={{ borderColor: BRAND.border }}
                      value={expandedProjectDraft.deliverablesText}
                      disabled={projectsLocked}
                      ref={expandedDeliverablesRef}
                      onChange={(e) => {
                        setExpandedProjectDraft((prev) =>
                          prev ? { ...prev, deliverablesText: e.target.value } : prev
                        );
                        setExpandedProjectDirty(true);
                      }}
                      placeholder="Deliverables / outcomes (one per line)"
                    />
                    <textarea
                      className="mt-3 min-h-[120px] w-full rounded border px-2 py-2 text-sm font-semibold outline-none"
                      style={{ borderColor: BRAND.border }}
                      value={expandedProjectDraft.projectedToolsText}
                      disabled={projectsLocked}
                      onChange={(e) => {
                        setExpandedProjectDraft((prev) =>
                          prev ? { ...prev, projectedToolsText: e.target.value } : prev
                        );
                        setExpandedProjectDirty(true);
                      }}
                      placeholder="Recommended tools (one per line)"
                    />
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(["bold", "italic", "bullet", "number"] as const).map((mode) => (
                        <button
                          key={`exp-del-${mode}`}
                          type="button"
                          className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                          style={{ borderColor: BRAND.border, color: BRAND.dark }}
                          disabled={projectsLocked}
                          onClick={() => applyProjectFormat(expandedProjectIndex, "deliverables", mode, "expanded")}
                        >
                          {mode === "bold"
                            ? "Bold"
                            : mode === "italic"
                              ? "Italic"
                              : mode === "bullet"
                                ? "Bullets"
                                : "Numbered"}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="mt-3 min-h-[220px] w-full rounded border px-2 py-2 text-sm font-semibold outline-none"
                      style={{ borderColor: BRAND.border }}
                      value={expandedProjectDraft.summary}
                      disabled={projectsLocked}
                      ref={expandedSummaryRef}
                      onChange={(e) => {
                        setExpandedProjectDraft((prev) => (prev ? { ...prev, summary: e.target.value } : prev));
                        setExpandedProjectDirty(true);
                      }}
                      placeholder="Project scope summary"
                    />
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(["bold", "italic", "bullet", "number"] as const).map((mode) => (
                        <button
                          key={`exp-sum-${mode}`}
                          type="button"
                          className="rounded border px-2 py-1 text-[10px] font-black uppercase"
                          style={{ borderColor: BRAND.border, color: BRAND.dark }}
                          disabled={projectsLocked}
                          onClick={() => applyProjectFormat(expandedProjectIndex, "summary", mode, "expanded")}
                        >
                          {mode === "bold"
                            ? "Bold"
                            : mode === "italic"
                              ? "Italic"
                              : mode === "bullet"
                                ? "Bullets"
                                : "Numbered"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {quote ? (
            <div className="mt-5 space-y-4">
              <div
                className="rounded-2xl border px-4 py-4"
                style={{ borderColor: BRAND.border, background: "rgba(52, 176, 180, 0.06)" }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Company logo"
                        className="mb-2 h-10 w-auto object-contain"
                      />
                    ) : null}
                    <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.dark }}>
                      Scope → quote builder
                    </div>
                    <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
                      Turn project scope into line items: estimate hours, classify assessment vs pilot vs à la carte,
                      and map each row to a price book SKU. Then apply selections to the table below.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/admin/crm/quotes/${quote.id}/preview`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border bg-white px-4 py-2 text-sm font-black uppercase shadow-sm"
                      style={{ borderColor: BRAND.border, color: BRAND.dark }}
                    >
                      View Quote
                    </a>
                    <a
                      href={`/admin/crm/quotes/${quote.id}/client`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border bg-white px-4 py-2 text-sm font-black uppercase shadow-sm"
                      style={{ borderColor: BRAND.border, color: BRAND.dark }}
                    >
                      Client Side Quote
                    </a>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
                      style={{ background: BRAND.dark }}
                      onClick={() => void saveQuoteAsActiveForPm()}
                    >
                      Save active quote for PM
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs font-semibold" style={{ color: BRAND.muted }}>
                  DocuSign e-signature is not wired up yet; export PDF for now and sign outside the app.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Default company tier
                  </label>
                  <select
                    className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold outline-none"
                    style={{ borderColor: BRAND.border }}
                    value={topCompanyTier}
                    onChange={(e) => void setTopCompanyTier(e.target.value)}
                  >
                    <option value="">Select tier</option>
                    {tierOptions.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>

                {workItems.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed px-4 py-6 text-center" style={{ borderColor: BRAND.border }}>
                    <p className="text-sm font-semibold" style={{ color: BRAND.muted }}>
                      No scope work items yet. Generate from the executive scope summary, or add rows manually.
                    </p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !scopeSummaryForWork?.projects?.length}
                        className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
                        style={{ background: BRAND.cyan }}
                        onClick={initWorkItemsFromScopeSummary}
                      >
                        Create from scope summary
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border bg-white px-4 py-2 text-sm font-black uppercase disabled:opacity-50"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        onClick={addWorkItemRow}
                      >
                        Add blank row
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl px-3 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                        style={{ background: BRAND.cyan }}
                        onClick={addWorkItemRow}
                      >
                        Add row
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border bg-white px-3 py-2 text-xs font-black uppercase disabled:opacity-50"
                        style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        onClick={autoMapWorkItemsByTitle}
                      >
                        Auto-map title to engagement
                      </button>
                    </div>
                    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: BRAND.border }}>
                      <table className="min-w-[1100px] w-full text-left text-sm">
                        <thead>
                          <tr className="text-[10px] font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                            <th className="px-2 py-2">Title</th>
                            <th className="px-2 py-2">Engagement</th>
                            <th className="px-2 py-2">Tier override</th>
                            <th className="px-2 py-2">Hourly / project</th>
                            <th className="px-2 py-2">Price mode</th>
                            <th className="px-2 py-2">Qty</th>
                            <th className="px-2 py-2">Build hrs</th>
                            <th className="px-2 py-2">Build time</th>
                            <th className="px-2 py-2">Discount %</th>
                            <th className="px-2 py-2">Final</th>
                            <th className="px-2 py-2">Notes</th>
                            <th className="px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {workItems.map((w, idx) => (
                            <tr key={w.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                              <td className="px-2 py-2 align-top">
                                <input
                                  className="w-[140px] rounded border px-2 py-1 text-xs outline-none sm:w-[160px]"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.title}
                                  onChange={(e) => updateWorkItem(idx, { title: e.target.value })}
                                />
                                <textarea
                                  className="mt-1 w-full min-w-[140px] rounded border px-2 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  rows={2}
                                  placeholder="Scope / deliverables"
                                  value={w.detail}
                                  onChange={(e) => updateWorkItem(idx, { detail: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <select
                                  className="w-[190px] rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.engagementName ?? ""}
                                  onChange={(e) => {
                                    const engagementName = e.target.value || null;
                                    const defaults = getBuildDefaultsForEngagement(engagementName, w.companyTierOverride);
                                    updateWorkItem(idx, {
                                      engagementName,
                                      linkedSku: null,
                                      buildHours: defaults.buildHours,
                                      buildTime: defaults.buildTime,
                                    });
                                  }}
                                >
                                  <option value="">Select engagement</option>
                                  {engagementOptions.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <select
                                  className="w-[130px] rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.companyTierOverride ?? ""}
                                  onChange={(e) => {
                                    const companyTierOverride = e.target.value || null;
                                    const defaults = getBuildDefaultsForEngagement(w.engagementName, companyTierOverride);
                                    updateWorkItem(idx, {
                                      companyTierOverride,
                                      buildHours: w.buildHours ?? defaults.buildHours,
                                      buildTime: w.buildTime ?? defaults.buildTime,
                                    });
                                  }}
                                >
                                  <option value="">Use default</option>
                                  {tierOptions.map((tier) => (
                                    <option key={tier} value={tier}>
                                      {tier}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <select
                                  className="max-w-[120px] rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.pricingModel}
                                  onChange={(e) =>
                                    updateWorkItem(idx, {
                                      pricingModel: e.target.value,
                                      pricingSelection:
                                        e.target.value === "HOURLY" ? "HOURLY_RATE_BASE" : "BASE_PRICE",
                                    })
                                  }
                                >
                                  <option value="PROJECT">Project</option>
                                  <option value="HOURLY">Hourly</option>
                                </select>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <select
                                  className="w-[160px] rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.pricingSelection}
                                  onChange={(e) => updateWorkItem(idx, { pricingSelection: e.target.value })}
                                >
                                  {w.pricingModel === "HOURLY" ? (
                                    <>
                                      <option value="HOURLY_RATE_BASE">Hourly Rate (Base)</option>
                                      <option value="HOURLY_RATE_MIN">Hourly Rate (Min)</option>
                                      <option value="HOURLY_RATE_MAX">Hourly Rate (Max)</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="BASE_PRICE">Base Price</option>
                                      <option value="MIN_PRICE">Min Price</option>
                                      <option value="MAX_PRICE">Max Price</option>
                                    </>
                                  )}
                                </select>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="w-16 rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border, appearance: "textfield" as const }}
                                  value={String(w.quantity ?? "")}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                                    const parsed = Number.parseFloat(raw);
                                    updateWorkItem(idx, {
                                      quantity: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                                    });
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.25}
                                  className="w-20 rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.buildHours ?? ""}
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    updateWorkItem(idx, {
                                      buildHours: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
                                    });
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input
                                  className="w-[120px] rounded border px-2 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.buildTime ?? ""}
                                  placeholder="e.g. 3 weeks"
                                  onChange={(e) => updateWorkItem(idx, { buildTime: e.target.value || null })}
                                />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  className="w-16 rounded border px-1 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.discountPct}
                                  onChange={(e) =>
                                    updateWorkItem(idx, {
                                      discountPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                                    })
                                  }
                                />
                              </td>
                              <td className="px-2 py-2 align-top text-xs font-black" style={{ color: BRAND.dark }}>
                                {fmtMoney(getLineFinalCents(w))}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <input
                                  className="w-[100px] rounded border px-2 py-1 text-xs outline-none"
                                  style={{ borderColor: BRAND.border }}
                                  value={w.notes}
                                  onChange={(e) => updateWorkItem(idx, { notes: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <button
                                  type="button"
                                  className="text-xs font-black uppercase"
                                  style={{ color: BRAND.danger }}
                                  onClick={() => removeWorkItemRow(idx)}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !quote.assessment_id}
                  className="rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={resyncQuoteFromScope}
                >
                  Re-sync from latest scope
                </button>
                <span className="self-center text-sm font-bold" style={{ color: BRAND.muted }}>
                  Total {fmtMoney(quote.total_cents)} • {quote.status}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border }}>
                  <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                    Price
                  </div>
                  <div className="mt-1 text-base font-black" style={{ color: BRAND.dark }}>
                    {fmtMoney(pricingSummary.priceCents)}
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border }}>
                  <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                    Pricing discount
                  </div>
                  <div className="mt-1 text-base font-black" style={{ color: BRAND.danger }}>
                    -{fmtMoney(pricingSummary.discountCents)}
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border, background: "rgba(23,52,100,0.05)" }}>
                  <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                    Total price
                  </div>
                  <div className="mt-1 text-base font-black" style={{ color: BRAND.dark }}>
                    {fmtMoney(pricingSummary.totalCents)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Overall quote discount %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  className="w-24 rounded-lg border px-2 py-1 text-xs font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={pricingSummary.overallDiscountPct}
                  onChange={(e) =>
                    void saveQuote({
                      ...payload,
                      quoteDiscountPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                />
                <span className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                  Applies after line-item discounts.
                </span>
              </div>
              {pricingSummary.overallDiscountPct > 0 ? (
                <div className="text-xs font-semibold" style={{ color: BRAND.muted }}>
                  Overall discount: -{fmtMoney(pricingSummary.overallDiscountCents)}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Signatory
                  </label>
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                    style={{ borderColor: BRAND.border }}
                    value={quote.signee_contact_id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__add") return;
                      void saveQuote(payload as Record<string, unknown>, {
                        signee_contact_id: v || null,
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="__add">+ Add new contact (use form above)</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.title ? ` — ${c.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                    Point of contact / billing
                  </label>
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                    style={{ borderColor: BRAND.border }}
                    value={quote.billing_contact_id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__add") return;
                      void saveQuote(payload as Record<string, unknown>, {
                        billing_contact_id: v || null,
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="__add">+ Add new contact (use form above)</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.title ? ` — ${c.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Cover narrative
                </label>
                <textarea
                  className="mt-1 min-h-[90px] w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={coverDraft}
                  onChange={(e) => setCoverDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded-lg px-3 py-1.5 text-xs font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={() => void saveQuote({ ...payload, coverNarrative: coverDraft })}
                >
                  Save narrative
                </button>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Payment terms
                </label>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={paymentTermsDraft}
                  onChange={(e) => setPaymentTermsDraft(e.target.value)}
                >
                  {QUOTE_PAYMENT_TERMS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded-lg px-3 py-1.5 text-xs font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={() => void saveQuote({ ...payload, paymentTerms: paymentTermsDraft })}
                >
                  Save payment terms
                </button>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Terms
                </label>
                <textarea
                  className="mt-1 min-h-[70px] w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={termsDraft}
                  onChange={(e) => setTermsDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded-lg px-3 py-1.5 text-xs font-black uppercase text-white disabled:opacity-50"
                  style={{ background: BRAND.dark }}
                  onClick={() => void saveQuote({ ...payload, terms: termsDraft })}
                >
                  Save terms
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="ml-2 mt-2 rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase disabled:opacity-50"
                  style={{ borderColor: BRAND.border, color: BRAND.dark }}
                  onClick={() =>
                    setTermsDraft(
                      `${QUOTE_STANDARD_TERMS_TEXT}\n\nThis Quote incorporates Northline Intelligence Standard Terms & Conditions (${QUOTE_STANDARD_TERMS_VERSION}).`
                    )
                  }
                >
                  Insert standard terms
                </button>
              </div>

              <div className="rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: BRAND.border, color: BRAND.muted }}>
                Quote pricing now comes from the scope line-item calculator above (engagement + tier + pricing mode + quantity + discount).
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Valid until
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                    style={{ borderColor: BRAND.border }}
                    value={validUntilDraft}
                    onChange={(e) => setValidUntilDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg px-3 py-1.5 text-xs font-black uppercase text-white disabled:opacity-50"
                    style={{ background: BRAND.dark }}
                    onClick={() =>
                      void saveQuote(payload as Record<string, unknown>, {
                        valid_until: validUntilDraft ? new Date(`${validUntilDraft}T23:59:59.000Z`).toISOString() : null,
                      })
                    }
                  >
                    Save valid until
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.muted }}>
                  Quote status
                </label>
                <select
                  className="mt-1 rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                  style={{ borderColor: BRAND.border }}
                  value={quote.status}
                  onChange={(e) =>
                    saveQuote(payload as Record<string, unknown>, { status: e.target.value as CrmQuoteStatus })
                  }
                >
                  {QUOTE_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {quoteStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm font-semibold" style={{ color: BRAND.muted }}>
              Select or create a quote to edit pricing and contacts.
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Customer Document Library
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            Centralized contracts, invoices, and assessment archives for this organization.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Contracts
            </div>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              {org.crm_contracts.map((c) => (
                <li key={c.id} className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border }}>
                  <span style={{ color: BRAND.dark }}>{c.title}</span>
                  <span className="ml-2 text-xs font-black uppercase" style={{ color: BRAND.muted }}>
                    {c.status}
                  </span>
                </li>
              ))}
              {org.crm_contracts.length === 0 ? (
                <li style={{ color: BRAND.muted }}>No contract records yet.</li>
              ) : null}
            </ul>
            <input
              className="mt-3 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
              style={{ borderColor: BRAND.border }}
              placeholder="Contract title"
              value={contractTitle}
              onChange={(e) => setContractTitle(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              style={{ background: BRAND.dark }}
              onClick={async () => {
                if (!contractTitle.trim()) return;
                setBusy(true);
                try {
                  const res = await fetch(`/api/admin/crm/organizations/${organizationId}/contracts`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: contractTitle.trim() }),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(json?.error || "Failed");
                  setContractTitle("");
                  await loadOrg();
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add contract record
            </button>
          </div>

          <div className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
              Invoices
            </div>
            <ul className="mt-3 space-y-2 text-sm font-semibold">
              {org.crm_invoices.map((inv) => (
                <li key={inv.id} className="rounded-lg border px-3 py-2" style={{ borderColor: BRAND.border }}>
                  <span style={{ color: BRAND.dark }}>{inv.title}</span> · {fmtMoney(inv.amount_cents)} · {inv.status}
                  {inv.due_date ? ` · due ${new Date(inv.due_date).toLocaleDateString()}` : ""}
                </li>
              ))}
              {org.crm_invoices.length === 0 ? (
                <li style={{ color: BRAND.muted }}>No invoices yet.</li>
              ) : null}
            </ul>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                style={{ borderColor: BRAND.border }}
                placeholder="Title"
                value={invoiceTitle}
                onChange={(e) => setInvoiceTitle(e.target.value)}
              />
              <input
                className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none"
                style={{ borderColor: BRAND.border }}
                placeholder="Amount (USD)"
                value={invoiceCents}
                onChange={(e) => setInvoiceCents(e.target.value)}
              />
              <input
                type="date"
                className="rounded-xl border px-3 py-2 text-sm font-semibold outline-none sm:col-span-2"
                style={{ borderColor: BRAND.border }}
                value={invoiceDue}
                onChange={(e) => setInvoiceDue(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={busy}
              className="mt-2 rounded-xl px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
              style={{ background: BRAND.cyan }}
              onClick={async () => {
                if (!invoiceTitle.trim()) return;
                const dollars = Number.parseFloat(invoiceCents.replace(/[^0-9.]/g, ""));
                if (!Number.isFinite(dollars)) {
                  alert("Enter a valid amount");
                  return;
                }
                const amount_cents = Math.round(dollars * 100);
                setBusy(true);
                try {
                  const res = await fetch(`/api/admin/crm/organizations/${organizationId}/invoices`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      title: invoiceTitle.trim(),
                      amount_cents,
                      due_date: invoiceDue ? new Date(`${invoiceDue}T12:00:00`).toISOString() : null,
                      status: "SENT",
                    }),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(json?.error || "Failed");
                  setInvoiceTitle("");
                  setInvoiceCents("");
                  setInvoiceDue("");
                  await loadOrg();
                } catch (e: unknown) {
                  alert(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add invoice
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white/95 p-5 shadow-sm" style={{ borderColor: BRAND.border }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
            Assessment Archives
          </div>
          <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.muted }}>
            One locked readout per assessment. Use these links to review prior assessments and export a dated PDF.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-wider" style={{ color: BRAND.greyBlue }}>
                  <th className="pb-2 pr-3">Assessment</th>
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {org.assessments.map((a) => (
                  <tr key={a.id} className="border-t font-semibold" style={{ borderColor: BRAND.border }}>
                    <td className="py-2 pr-3">{a.name || a.id}</td>
                    <td className="py-2 pr-3">{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-3">
                      {a.locked_at ? "Locked" : "In progress"} · {a.status}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/assessments/${a.id}/narrative`}
                          className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
                          style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        >
                          Insights
                        </a>
                        <a
                          href={`/assessments/${a.id}/project-scope`}
                          className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
                          style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        >
                          Scope
                        </a>
                        <a
                          href={`/api/admin/assessments/${a.id}/narrative/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border bg-white px-3 py-1.5 text-xs font-black uppercase"
                          style={{ borderColor: BRAND.border, color: BRAND.dark }}
                        >
                          PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
                {org.assessments.length === 0 ? (
                  <tr>
                    <td className="py-2" colSpan={4} style={{ color: BRAND.muted }}>
                      No assessments yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
    </AdminShell>
  );
}
