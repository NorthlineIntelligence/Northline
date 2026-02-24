export function getAdminEmailAllowlist(): string[] {
    const raw = process.env.NORTHLINE_ADMIN_EMAILS ?? "";
    return raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }
  
  export function isAdminEmail(email?: string | null): boolean {
    if (!email) return false;
  
    const allowlist = getAdminEmailAllowlist();
  
    // Fail closed if env var is missing
    if (allowlist.length === 0) return false;
  
    return allowlist.includes(email.toLowerCase());
  }
  