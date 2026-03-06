// src/lib/inviteAuth.ts
export type InviteAuth = {
    email: string;
    token: string;
  };
  
  const storageKey = (assessmentId: string) => `nl_invite_auth_${assessmentId}`;
  
  export function readInviteAuthFromUrl(searchParams: URLSearchParams): InviteAuth | null {
    const email = searchParams.get("email")?.trim() || "";
    const token = searchParams.get("token")?.trim() || "";
    if (!email || !token) return null;
    return { email, token };
  }
  
  export function saveInviteAuthToSession(assessmentId: string, auth: InviteAuth) {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(storageKey(assessmentId), JSON.stringify(auth));
  }
  
  export function loadInviteAuthFromSession(assessmentId: string): InviteAuth | null {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(storageKey(assessmentId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.email && parsed?.token) return { email: parsed.email, token: parsed.token };
      return null;
    } catch {
      return null;
    }
  }
  
  export function clearInviteAuthFromSession(assessmentId: string) {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(storageKey(assessmentId));
  }
  
  export function withInviteAuthQuery(url: string, auth: InviteAuth | null): string {
    if (!auth) return url;
    const u = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    u.searchParams.set("email", auth.email);
    u.searchParams.set("token", auth.token);
    // If running server-side, strip origin back out
    return typeof window === "undefined" ? u.pathname + "?" + u.searchParams.toString() : u.toString();
  }