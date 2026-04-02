import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_EXCERPT_CHARS = 14_000;

const DEFAULT_WEB_CONTEXT_MODEL = "claude-3-5-haiku-20241022";

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function normalizePublicWebsiteUrl(raw: string | null | undefined): URL | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || isBlockedHost(url.hostname)) return null;
  return url;
}

export function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|blockquote)>/gi, "\n");
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
  return s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export async function fetchPublicWebsiteExcerpt(url: URL): Promise<{
  excerpt: string;
  excerptSha256: string;
} | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": "NorthlineReadinessResearch/1.0 (executive memo enrichment; +https://northlineintelligence.com)",
      },
    });

    if (!res.ok) return null;

    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_RESPONSE_BYTES) return null;

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) return null;

    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const plain = htmlToPlainText(html);
    if (!plain || plain.length < 80) return null;

    const excerpt = plain.slice(0, MAX_EXCERPT_CHARS);
    return { excerpt, excerptSha256: sha256Hex(excerpt) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Second, smaller model call: turn raw public HTML text into anonymized business context
 * for the main narrative model. No URL or legal name is passed in; excerpt may still contain
 * names — instructions tell the model not to repeat them.
 */
export async function summarizePublicWebExcerptForMemo(args: {
  excerpt: string;
  industry: string | null;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const model =
    process.env.NARRATIVE_WEB_CONTEXT_MODEL?.trim() || DEFAULT_WEB_CONTEXT_MODEL;
  const client = new Anthropic({ apiKey });

  const industryLine = args.industry?.trim()
    ? `Optional sector hint from the client record (may be inaccurate): ${args.industry.trim()}\n`
    : "";

  const userBlock = [
    industryLine,
    "Below is plain text extracted from an organization's public website HTML.",
    "Task: Produce a compact, factual briefing for an internal AI readiness workshop memo.",
    "",
    "Rules:",
    "- Do NOT output legal entity names, brand names, product trademarks, people's names, or URLs.",
    "- Write in neutral third person (e.g. “the organization”, “this business”).",
    "- Focus on: what they appear to do, who they likely serve, how they go to market, operational scale cues, and anywhere AI/automation could plausibly help (customer-facing, ops, data, support, content).",
    "- If the excerpt is marketing fluff only, say so briefly and list only high-confidence inferences.",
    "- Return ONLY valid JSON: {\"bullets\": string[]} with 3–10 short strings (each under 400 characters).",
    "",
    "EXCERPT:\n",
    args.excerpt.slice(0, MAX_EXCERPT_CHARS),
  ].join("\n");

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system:
        "You transform noisy public webpage text into anonymized strategic context. " +
        "Never echo company names or domains from the excerpt.",
      messages: [{ role: "user", content: userBlock }],
    });

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("")
      .trim();

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    const parsed = JSON.parse(text.slice(start, end + 1)) as { bullets?: unknown };
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets.filter((b) => typeof b === "string" && (b as string).trim())
      : [];
    if (bullets.length === 0) return null;

    return (bullets as string[])
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 10)
      .join("\n");
  } catch {
    return null;
  }
}

export function isWebEnrichmentEnabled(): boolean {
  const raw = process.env.NARRATIVE_WEB_ENRICHMENT_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  return String(raw).toLowerCase() === "true" || String(raw) === "1";
}
