// src/lib/api.ts
// Drop-in client for the party backend. Reads the API base URL from a Vite env var.
// In Cloudflare Pages set:  VITE_API_URL = https://prrrtpal-housewarming-api.onrender.com
//
// The JWT is kept in sessionStorage so a guest isn't re-prompted on every reload,
// but it clears when the tab/browser closes. Swap to localStorage if you want it
// to persist longer.

const BASE = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") || "";

const TOKEN_KEY = "house:token";
const ROLE_KEY = "house:role";

export type Role = "guest" | "admin" | "family";
export type ThemeName = "warm" | "pool"; // site-wide visual theme, host-picked

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function getRole(): Role | null {
  try { return (sessionStorage.getItem(ROLE_KEY) as Role) || null; } catch { return null; }
}
export function isUnlocked(): boolean {
  return !!getToken();
}
export function logout(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(ROLE_KEY); } catch {}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    const err = new Error(body?.error || `Request failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ---------- auth / event ---------- */

// Public branding for the gate (no address). Safe to call before unlocking.
export function getPublic(): Promise<{ familyName: string; defaultTheme: "day" | "night"; themeName: ThemeName }> {
  return request("/api/public");
}

// Exchange a passcode for a token. Stores it on success and returns the role.
export async function authenticate(passcode: string): Promise<Role> {
  const data = await request<{ role: Role; token: string }>("/api/auth", {
    method: "POST",
    body: JSON.stringify({ passcode }),
  });
  try {
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(ROLE_KEY, data.role);
  } catch {}
  return data.role;
}

export interface SectionFlags { countdown: boolean; details: boolean; rsvp: boolean; food: boolean; photos: boolean; gifts: boolean; game: boolean; gameCenter: boolean; }
export interface EventDetails {
  themeName: ThemeName;
  requireRsvpApproval: boolean; // host toggle: gate the address behind RSVP approval
  addressLocked?: boolean; // true = guest must have an approved RSVP to get the address
  familyName: string; tagline: string; defaultTheme: "day" | "night";
  partyDate: string; timeLabel: string; venueName: string; address: string;
  hostNote: string; rsvpDeadline: string; dishCategories: string[];
  registryUrl?: string;
  sections: SectionFlags;
}
export function getEvent(): Promise<EventDetails> {
  return request("/api/event");
}

// The subset of event fields the host can edit live from the Host panel.
export interface EventContent {
  themeName: ThemeName;
  requireRsvpApproval: boolean;
  familyName: string; tagline: string; partyDate: string; timeLabel: string;
  venueName: string; address: string; hostNote: string; rsvpDeadline: string;
  dishCategories: string[]; registryUrl: string;
}

/* ---------- RSVPs ---------- */
export type RsvpStatus = "yes" | "maybe" | "no";
export interface Rsvp {
  approved: boolean; id: string; name: string; status: RsvpStatus; party_size: number; message: string; email: string; phone: string; created_at: string; }
export const rsvps = {
  list: (): Promise<Rsvp[]> => request("/api/rsvps"),
  create: (r: { name: string; status: RsvpStatus; partySize: number; message?: string; email?: string; phone?: string; pin?: string }): Promise<Rsvp & { editToken: string }> =>
    request("/api/rsvps", { method: "POST", body: JSON.stringify(r) }),
  // Recover an RSVP from any device with name + PIN; returns the edit token on a match.
  lookup: (name: string, pin: string): Promise<{ id: string; editToken: string; name: string; status: RsvpStatus; party_size: number; message: string; email: string; phone: string }> =>
    request("/api/rsvps/lookup", { method: "POST", body: JSON.stringify({ name, pin }) }),
  // Guest editing their own RSVP, authorized by the secret token they got at create time.
  approve: (id: string, approved: boolean): Promise<Rsvp> =>
    request(`/api/rsvps/${id}/approve`, { method: "PATCH", body: JSON.stringify({ approved }) }),
  access: (id: string, editToken: string): Promise<{ approved: boolean; address?: string; venueName?: string }> =>
    request(`/api/rsvps/${id}/access`, { method: "POST", body: JSON.stringify({ editToken }) }),
  updateSelf: (id: string, editToken: string, patch: { name?: string; status?: RsvpStatus; partySize?: number; message?: string; email?: string; phone?: string }): Promise<Rsvp> =>
    request(`/api/rsvps/${id}/self`, { method: "PATCH", body: JSON.stringify({ ...patch, editToken }) }),
  update: (id: string, patch: { name?: string; status?: RsvpStatus; partySize?: number; message?: string; email?: string; phone?: string }): Promise<Rsvp> =>
    request(`/api/rsvps/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string): Promise<{ ok: true }> => request(`/api/rsvps/${id}`, { method: "DELETE" }),
};

/* ---------- Potluck ---------- */
export interface Dish { id: string; category: string; name: string; dish: string; created_at: string; }
export const potluck = {
  list: (): Promise<Dish[]> => request("/api/potluck"),
  create: (d: { category: string; name: string; dish: string }): Promise<Dish> =>
    request("/api/potluck", { method: "POST", body: JSON.stringify(d) }),
  update: (id: string, patch: { category?: string; name?: string; dish?: string }): Promise<Dish> =>
    request(`/api/potluck/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string): Promise<{ ok: true }> => request(`/api/potluck/${id}`, { method: "DELETE" }),
};

/* ---------- Gift claims ---------- */
export interface Claim { gift_id: string; claimed_by: string; created_at: string; }
export interface Reveal { gift_id: string; claimed_by: string; message: string; voice_url: string; ecard_id: string; ecard_custom_url: string; title: string; image_url: string; link: string; price: string; created_at: string; }
export const gifts = {
  claims: (): Promise<Claim[]> => request("/api/gifts/claims"),
  // Reveal = reserved gifts with who-from + note + voice + ecard. Host & family-code only.
  reveal: (): Promise<Reveal[]> => request("/api/gifts/reveal"),
  // Throws an Error with .status === 409 if the gift is already reserved.
  claim: (giftId: string, claimedBy: string, message?: string, voiceUrl?: string, ecardId?: string, ecardCustomUrl?: string): Promise<Claim> =>
    request("/api/gifts/claims", { method: "POST", body: JSON.stringify({ giftId, claimedBy, message, voiceUrl, ecardId, ecardCustomUrl }) }),
  unclaim: (giftId: string): Promise<{ ok: true }> =>
    request(`/api/gifts/claims/${giftId}`, { method: "DELETE" }),
};

/* ---------- Wishlist items (admin can create/edit/delete) ---------- */
export interface WishlistItem { id: string; title: string; note: string; link: string; image_url: string; price: string; sort_order: number; }
type WishlistInput = { title: string; note?: string; link?: string; image_url?: string; price?: string };
export const wishlist = {
  list: (): Promise<WishlistItem[]> => request("/api/wishlist"),
  create: (item: WishlistInput): Promise<WishlistItem> =>
    request("/api/wishlist", { method: "POST", body: JSON.stringify(item) }),
  update: (id: string, patch: Partial<WishlistInput>): Promise<WishlistItem> =>
    request(`/api/wishlist/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string): Promise<{ ok: true }> =>
    request(`/api/wishlist/${id}`, { method: "DELETE" }),
  bulkUpsert: (items: Array<{ id?: string; title: string; note?: string; link?: string; image_url?: string; price?: string }>): Promise<{ inserted: number; updated: number; total: number }> =>
    request("/api/wishlist/bulk", { method: "POST", body: JSON.stringify({ items }) }),
};

/* ---------- Admin (host only) ---------- */
export const admin = {
  clear: (scope: "rsvps" | "potluck" | "gifts" | "wishlist" | "predictions" | "games" | "all"): Promise<{ ok: true; cleared: string }> =>
    request("/api/admin/clear", { method: "POST", body: JSON.stringify({ scope }) }),
  setSections: (partial: Partial<SectionFlags>): Promise<SectionFlags> =>
    request("/api/admin/sections", { method: "PATCH", body: JSON.stringify(partial) }),
  setContent: (partial: Partial<EventContent>): Promise<EventContent> =>
    request("/api/admin/content", { method: "PATCH", body: JSON.stringify(partial) }),
};

/* ---------- House Predictions game ---------- */
export interface Prediction { id: string; name: string; answers: Record<string, string>; created_at: string; }
export const predictions = {
  // Guests get { count, entries: null }; host & family get the full entries too.
  list: (): Promise<{ count: number; entries: Prediction[] | null }> => request("/api/predictions"),
  submit: (name: string, answers: Record<string, string>): Promise<Prediction> =>
    request("/api/predictions", { method: "POST", body: JSON.stringify({ name, answers }) }),
  remove: (id: string): Promise<{ ok: true }> => request(`/api/predictions/${id}`, { method: "DELETE" }),
};

/* ---------- Game Center (host uploads photos of the games on hand) ---------- */
export interface GameItem { id: string; title: string; image_url: string; description: string; created_at: string; }
export const games = {
  list: (): Promise<GameItem[]> => request("/api/games"),
  create: (g: { title: string; imageUrl?: string; description?: string }): Promise<GameItem> =>
    request("/api/games", { method: "POST", body: JSON.stringify(g) }),
  update: (id: string, patch: { title?: string; imageUrl?: string; description?: string }): Promise<GameItem> =>
    request(`/api/games/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string): Promise<{ ok: true }> => request(`/api/games/${id}`, { method: "DELETE" }),
};

/* ---------- Gallery (guest photo uploads via Cloudinary) ---------- */
export interface GalleryPhoto { id: string; url: string; caption: string; uploaded_by: string; approved: boolean; created_at: string; }

const CLOUD_NAME = (import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = (import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET || "";
export const cloudinaryConfigured = !!(CLOUD_NAME && UPLOAD_PRESET);

// Uploads the file straight to Cloudinary (bytes never touch our server) and returns the hosted URL.
export async function uploadImage(file: File): Promise<string> {
  if (!cloudinaryConfigured) throw new Error("Photo uploads aren't configured yet.");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.secure_url as string;
}

// Uploads recorded audio (a Blob) to Cloudinary via the auto endpoint and returns the hosted URL.
export async function uploadAudio(blob: Blob): Promise<string> {
  if (!cloudinaryConfigured) throw new Error("Voice messages aren't configured yet.");
  const fd = new FormData();
  fd.append("file", blob);
  fd.append("upload_preset", UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Voice upload failed");
  const data = await res.json();
  return data.secure_url as string;
}

// Uploads a custom ecard image (File) to Cloudinary and returns the hosted URL.
export async function uploadEcardImage(file: File): Promise<string> {
  if (!cloudinaryConfigured) throw new Error("Photo uploads aren't configured yet.");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Ecard image upload failed");
  const data = await res.json();
  return data.secure_url as string;
}

// Derive a square thumbnail URL from a Cloudinary image URL (auto quality/format).
export function thumbUrl(url: string, size = 400): string {
  return url.includes("/upload/") ? url.replace("/upload/", `/upload/c_fill,w_${size},h_${size},q_auto,f_auto/`) : url;
}

export const gallery = {
  list: (): Promise<GalleryPhoto[]> => request("/api/gallery"),
  add: (photo: { url: string; caption?: string; uploadedBy?: string }): Promise<GalleryPhoto> =>
    request("/api/gallery", { method: "POST", body: JSON.stringify(photo) }),
  approve: (id: string): Promise<GalleryPhoto> => request(`/api/gallery/${id}/approve`, { method: "PATCH" }),
  remove: (id: string): Promise<{ ok: true }> => request(`/api/gallery/${id}`, { method: "DELETE" }),
  importFromCloudinary: (): Promise<{ imported: number; total: number }> => request("/api/gallery/import", { method: "POST" }),
};
