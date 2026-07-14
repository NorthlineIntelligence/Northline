const ALLOWED_TAGS = new Set([
  "p",
  "div",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "span",
  "a",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  span: new Set(["style"]),
  p: new Set(["style"]),
  div: new Set(["style"]),
  li: new Set(["style"]),
};

function isSafeHref(value: string) {
  const href = value.trim().toLowerCase();
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
}

function isSafeStyle(value: string) {
  const style = value.toLowerCase();
  if (style.includes("expression(") || style.includes("javascript:") || style.includes("url(")) {
    return false;
  }
  return /^[\w\s#%,.;:()\-'"\/]+$/.test(style);
}

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment();
    Array.from(element.childNodes).forEach((child) => {
      const sanitized = sanitizeNode(child, doc);
      if (sanitized) fragment.appendChild(sanitized);
    });
    return fragment.childNodes.length ? fragment : null;
  }

  const clean = doc.createElement(tag);
  const allowedAttrs = ALLOWED_ATTRS[tag] ?? new Set<string>();

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    if (!allowedAttrs.has(name)) continue;

    if (name === "href") {
      if (!isSafeHref(attr.value)) continue;
      clean.setAttribute("href", attr.value);
      clean.setAttribute("rel", "noopener noreferrer");
      continue;
    }

    if (name === "target") {
      clean.setAttribute("target", "_blank");
      continue;
    }

    if (name === "style") {
      if (!isSafeStyle(attr.value)) continue;
      clean.setAttribute("style", attr.value);
      continue;
    }
  }

  Array.from(element.childNodes).forEach((child) => {
    const sanitized = sanitizeNode(child, doc);
    if (sanitized) clean.appendChild(sanitized);
  });

  return clean;
}

export function sanitizeConsultantNotesHtml(input: string | null | undefined): string | null {
  const html = (input ?? "").trim();
  if (!html) return null;

  if (typeof DOMParser === "undefined") {
    return sanitizeConsultantNotesHtmlFallback(html);
  }

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return null;

  const output = doc.createElement("div");
  Array.from(root.childNodes).forEach((child) => {
    const sanitized = sanitizeNode(child, doc);
    if (sanitized) output.appendChild(sanitized);
  });

  const result = output.innerHTML.trim();
  return result || null;
}

export function plainTextToConsultantNotesHtml(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const blocks = trimmed.split(/\n{2,}/g).map((block) => block.trim()).filter(Boolean);
  const html = blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.every((line) => line.startsWith("- "))) {
        return `<ul>${lines.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join("")}</ul>`;
      }
      return `<p>${escapeHtml(lines.join(" "))}</p>`;
    })
    .join("");

  return sanitizeConsultantNotesHtml(html);
}

function sanitizeConsultantNotesHtmlFallback(html: string): string | null {
  const cleaned = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .trim();

  return cleaned || null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
