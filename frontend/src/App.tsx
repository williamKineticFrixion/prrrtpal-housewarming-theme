import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  getPublic, authenticate, authenticateGuestPin, getEvent, isUnlocked, getRole, logout,
  rsvps, potluck, gifts, wishlist, gallery, predictions, games as gamesApi, uploadImage, uploadAudio, uploadEcardImage, thumbUrl, cloudinaryConfigured, admin,
  type Role, type EventDetails, type EventContent, type Rsvp, type RsvpStatus, type Dish, type Claim, type WishlistItem, type GalleryPhoto, type SectionFlags, type Reveal, type Prediction, type ThemeName, type GameItem, type GuestListView, type RsvpSelf,
} from "./lib/api";
import { ECARDS } from "./lib/ecards";
import { ECARD_FACES } from "./components/ECardFaces";
import { FlipCard } from "./components/FlipCard";

// Housewarming palette: terracotta, sage, honey gold, dusty blue, clay rose, warm brown.
const COLORS = ["#C96F4A", "#7C9A6D", "#D9A441", "#7D97B8", "#C98A8A", "#9A6B4F"];

// The guest's own RSVP identity (id + secret edit token), stored on this device
// at RSVP time and recoverable on another device via name + PIN.
// Visiting /admin shows the gate in host mode: only the admin code is accepted
// there. (Cloudflare Pages serves the SPA for this path via public/_redirects.)
const IS_ADMIN_ROUTE = window.location.pathname.replace(/\/+$/, "") === "/admin";
const cleanAdminPath = () => { try { history.replaceState(null, "", "/" + window.location.search + window.location.hash); } catch { /* ignore */ } };

const MINE_KEY = "party:myRsvp";
type AddressUnlock = { approved: boolean; address?: string; venueName?: string };
function readMine(): { id: string; editToken: string } | null {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { id: string; editToken: string };
    return saved?.id && saved?.editToken ? saved : null;
  } catch { return null; }
}

// Photos are non-sensitive, so they live client-side. Replace url:"" with real image URLs.
// To use a custom background image (e.g. a ChatGPT-generated housewarming scene),
// point --page-bg at it:  "url('/images/house-bg.jpg') center/cover no-repeat, #F7F1E6"
// Two site themes, each with a day + night variant. The host picks the theme
// live from the Host panel ("warm" housewarming vs "pool" summer pool party);
// guests still get the day/night toggle within whichever theme is active.
const THEMES: Record<ThemeName, Record<"day" | "night", Record<string, string>>> = {
  warm: {
    day: {
      "--page-bg":
        "radial-gradient(circle at 15% 15%, #F3E4D2 0, transparent 42%), radial-gradient(circle at 85% 10%, #E7EAD9 0, transparent 42%), radial-gradient(circle at 50% 100%, #F1E2CE 0, transparent 55%), #F7F1E6",
      "--surface": "#fffdf8", "--text": "#3d3229", "--muted": "#8a7a6a",
      "--input-bg": "#f6efe3", "--input-border": "#e6d8c2",
      "--nav-bg": "rgba(255,253,248,0.78)", "--nav-border": "rgba(230,216,194,0.9)",
    },
    night: {
      "--page-bg":
        "radial-gradient(circle at 20% 12%, #3d3226 0, transparent 45%), radial-gradient(circle at 82% 16%, #2a3040 0, transparent 45%), #191410",
      "--surface": "#262019", "--text": "#f3ede3", "--muted": "#c0b09c",
      "--input-bg": "rgba(255,255,255,0.07)", "--input-border": "rgba(255,255,255,0.16)",
      "--nav-bg": "rgba(25,20,16,0.74)", "--nav-border": "rgba(255,255,255,0.10)",
    },
  },
  // Summer pool party: aqua water, sunny sand, coral accents (day) and an
  // evening-swim deep teal with pool-light glow (night).
  pool: {
    day: {
      "--page-bg":
        "radial-gradient(circle at 15% 12%, #CDEFF7 0, transparent 45%), radial-gradient(circle at 85% 8%, #FDF3D6 0, transparent 42%), radial-gradient(circle at 50% 100%, #BEE9F2 0, transparent 55%), #EAF7FA",
      "--surface": "#fcffff", "--text": "#1e3a47", "--muted": "#5b7f8d",
      "--input-bg": "#e8f5f9", "--input-border": "#c4e3ed",
      "--nav-bg": "rgba(252,255,255,0.78)", "--nav-border": "rgba(196,227,237,0.9)",
    },
    night: {
      "--page-bg":
        "radial-gradient(circle at 20% 12%, #14404f 0, transparent 45%), radial-gradient(circle at 82% 16%, #24305c 0, transparent 45%), #0c1a24",
      "--surface": "#122530", "--text": "#e6f4f8", "--muted": "#9cbcc8",
      "--input-bg": "rgba(255,255,255,0.07)", "--input-border": "rgba(255,255,255,0.16)",
      "--nav-bg": "rgba(12,26,36,0.74)", "--nav-border": "rgba(255,255,255,0.10)",
    },
  },
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export default function App() {
  const [night, setNight] = useState(false);
  const [access, setAccess] = useState<"checking" | "locked" | Role>("checking");
  const [pub, setPub] = useState<{ familyName: string; themeName?: ThemeName } | null>(null);
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [preview, setPreview] = useState(false); // host previewing the family keepsake view
  const [editDetails, setEditDetails] = useState(false); // host editing live event details
  // const [showIntro, setShowIntro] = useState(false);

  // Called on a FRESH unlock (not a resumed session). Plays the intro once per device.
  // const enter = useCallback((role: Role) => {
  //   setAccess(role);
  //   try { if (!localStorage.getItem("house:introSeen")) setShowIntro(true); } catch { /* ignore */ }
  // }, []);
  // const finishIntro = useCallback(() => {
  //   try { localStorage.setItem("house:introSeen", "1"); } catch { /* ignore */ }
  //   setShowIntro(false);
  // }, []);
  const enter = useCallback((role: Role) => {
    if (IS_ADMIN_ROUTE) cleanAdminPath();
    setAccess(role);
  }, []);

  // On load: fetch public branding, set default theme, resume any saved session,
  // and support QR auto-unlock via a #code in the URL (guest access only).
  useEffect(() => {
    getPublic()
      .then((p) => { setPub(p); setNight(p.defaultTheme === "night"); })
      .catch(() => {});

    if (isUnlocked()) {
      const saved = (getRole() as Role) || null;
      // On /admin, an existing ADMIN session passes through; any other session
      // stays locked at the host gate (their token is kept — entering the admin
      // code upgrades it, and plain "/" still works with their old session).
      if (IS_ADMIN_ROUTE && saved !== "admin") { setAccess("locked"); return; }
      if (IS_ADMIN_ROUTE) cleanAdminPath();
      setAccess(saved || "locked");
      return;
    }

    const hashCode = IS_ADMIN_ROUTE ? "" : decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).trim();
    if (hashCode) {
      authenticate(hashCode)
        .then((role) => {
          // A code in the URL only ever grants GUEST access; host & family codes must be typed.
          if (role === "guest") enter("guest");
          else { logout(); setAccess("locked"); }
        })
        .catch(() => setAccess("locked"))
        .finally(() => {
          // Strip the code from the address bar so it isn't left visible or re-run.
          history.replaceState(null, "", window.location.pathname + window.location.search);
        });
    } else {
      setAccess("locked");
    }
  }, []);

  // Once unlocked, load the protected event details (address, wishlist, etc.).
  useEffect(() => {
    if ((access === "guest" || access === "admin" || access === "family") && !event) {
      getEvent()
        .then(setEvent)
        .catch((e: any) => {
          if (e?.status === 401) { logout(); setAccess("locked"); } // token expired
        });
    }
  }, [access, event]);

  // Admin: toggle which sections guests can see; reflect the change immediately.
  const updateSections = async (partial: Partial<SectionFlags>) => {
    try {
      const next = await admin.setSections(partial);
      setEvent((ev) => (ev ? { ...ev, sections: next } : ev));
    } catch { /* ignore */ }
  };

  // Guest address unlock: if the event says the address is gated, check whether
  // this device's RSVP has been approved by the host (re-checked on refresh).
  const [unlock, setUnlock] = useState<AddressUnlock | null>(null);
  useEffect(() => {
    if (!event?.addressLocked || access !== "guest") { setUnlock(null); return; }
    const mine = readMine();
    if (!mine) { setUnlock(null); return; }
    let alive = true;
    rsvps.access(mine.id, mine.editToken)
      .then((u) => { if (alive) setUnlock(u); })
      .catch(() => { if (alive) setUnlock(null); });
    return () => { alive = false; };
  }, [event?.addressLocked, access, refreshKey]);

  // Admin: toggle the approval requirement live (host panel).
  const setRequireApproval = async (requireRsvpApproval: boolean) => {
    try {
      const next = await admin.setContent({ requireRsvpApproval });
      setEvent((ev) => (ev ? { ...ev, ...next, addressLocked: false } : ev)); // admin always sees the address
    } catch { /* ignore */ }
  };

  // Admin: open/close guest entry live (host panel toggle).
  const setGuestEnabled = async (guestCodeEnabled: boolean) => {
    try {
      const next = await admin.setContent({ guestCodeEnabled });
      setEvent((ev) => (ev ? { ...ev, ...next } : ev));
    } catch { /* ignore */ }
  };

  // Admin: switch the site theme live (persisted with the other host-edited content).
  const setSiteTheme = async (themeName: ThemeName) => {
    try {
      const next = await admin.setContent({ themeName });
      setEvent((ev) => (ev ? { ...ev, ...next } : ev));
      setPub((p) => (p ? { ...p, themeName: next.themeName } : p));
    } catch { /* ignore */ }
  };

  // Theme resolves from event (post-login) → public branding (gate screen) → warm default.
  const themeName: ThemeName = event?.themeName ?? pub?.themeName ?? "warm";
  const vars = THEMES[themeName][night ? "night" : "day"];

  return (
    <div
      style={{ background: "var(--page-bg)", color: "var(--text)", minHeight: "100vh", ...vars }}
      className="relative overflow-x-hidden"
    >
      {night ? <NightSky /> : themeName === "pool" ? <PoolFloats /> : <Balloons />}

      {/* {showIntro && <IntroVideo onDone={finishIntro} />} */}

      {access === "checking" ? (
        <Splash text="🏡 Loading…" />
      ) : access === "locked" ? (
        <Gate pub={pub} hostMode={IS_ADMIN_ROUTE} onUnlock={enter} />
      ) : !event ? (
        <Splash text="🎉 Getting the house ready… 🎉" />
      ) : access === "family" ? (
        <FamilyKeepsake event={event} night={night} onToggleTheme={() => setNight((n) => !n)} onExit={() => { logout(); setAccess("locked"); setEvent(null); }} />
      ) : (
        <>
          <NavBar event={event} sections={event.sections} isAdmin={access === "admin"} night={night} onToggle={() => setNight((n) => !n)} />
          <Hero event={event} />
          <MaybeSection visible={event.sections.countdown} isAdmin={access === "admin"}><Countdown partyDate={event.partyDate} /></MaybeSection>
          <MaybeSection visible={event.sections.details} isAdmin={access === "admin"}><Details event={event} role={access} unlock={unlock} /></MaybeSection>
          <MaybeSection visible={event.sections.rsvp} isAdmin={access === "admin"}><RSVP refreshKey={refreshKey} isAdmin={access === "admin"} addressGated={!!event.addressLocked || (access !== "guest" && event.requireRsvpApproval)} onUnlockChange={() => setRefreshKey((k) => k + 1)} /></MaybeSection>
          <MaybeSection visible={event.sections.food} isAdmin={access === "admin"}><DishSignup categories={event.dishCategories} isAdmin={access === "admin"} refreshKey={refreshKey} /></MaybeSection>
          <MaybeSection visible={event.sections.photos} isAdmin={access === "admin"}><Gallery isAdmin={access === "admin"} partyDate={event.partyDate} refreshKey={refreshKey} /></MaybeSection>
          <MaybeSection visible={event.sections.game} isAdmin={access === "admin"}><Predictions role={access} refreshKey={refreshKey} /></MaybeSection>
          <MaybeSection visible={event.sections.gameCenter} isAdmin={access === "admin"}><GameCenter isAdmin={access === "admin"} refreshKey={refreshKey} /></MaybeSection>
          <MaybeSection visible={event.sections.gifts} isAdmin={access === "admin"}><Registry registryUrl={event.registryUrl} isAdmin={access === "admin"} refreshKey={refreshKey} /></MaybeSection>
          <Footer venueName={event.venueName} />
          {access === "admin" && (
            <HostPanel
              sections={event.sections}
              onSetSections={updateSections}
              themeName={themeName}
              onSetTheme={setSiteTheme}
              requireApproval={event.requireRsvpApproval}
              onSetRequireApproval={setRequireApproval}
              guestEnabled={event.guestCodeEnabled}
              onSetGuestEnabled={setGuestEnabled}
              familyName={event.familyName}
              onRefresh={() => setRefreshKey((k) => k + 1)}
              onPreview={() => setPreview(true)}
              onEditDetails={() => setEditDetails(true)}
              onLock={() => { logout(); setAccess("locked"); setEvent(null); }}
              onViewGuest={() => setAccess("guest")}
            />
          )}
          {access === "admin" && preview && (
            <div className="fixed inset-0 z-[200] overflow-auto" style={{ background: "var(--page-bg)", color: "var(--text)", ...vars }}>
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-2 text-sm font-extrabold shadow" style={{ background: "#7C9A6D", color: "#fff" }}>
                <span>👀 Preview — this is what the family-code holder sees</span>
                <button onClick={() => setPreview(false)} className="px-3 py-1 rounded-full font-bold" style={{ background: "rgba(255,255,255,.25)" }}>✕ Close preview</button>
              </div>
              <FamilyKeepsake event={event} night={night} onToggleTheme={() => setNight((n) => !n)} onExit={() => setPreview(false)} />
            </div>
          )}
          {access === "admin" && editDetails && (
            <EditDetailsModal
              event={event}
              onClose={() => setEditDetails(false)}
              onSaved={(next) => { setEvent((ev) => (ev ? { ...ev, ...next } : ev)); setEditDetails(false); setRefreshKey((k) => k + 1); }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="display text-2xl font-bold floaty" style={{ color: "#C96F4A" }}>{text}</p>
    </div>
  );
}

// One-time welcome video, shown the first time a guest enters the code on a device.
function IntroVideo({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // Try to play with sound; if the browser blocks it, fall back to muted autoplay.
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }, []);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black">
      <video ref={ref} src="/intro.mp4" autoPlay playsInline controls onEnded={onDone} className="max-h-full max-w-full" />
      <button onClick={onDone} className="btn-pop absolute top-4 right-4 px-5 py-2 rounded-full font-extrabold text-white shadow-lg" style={{ background: "rgba(0,0,0,.55)" }}>
        Skip ✕
      </button>
    </div>
  );
}

// Hidden sections vanish for guests, but the admin still sees them (with a banner) so they can edit.
function MaybeSection({ visible, isAdmin, children }: { visible: boolean; isAdmin: boolean; children: React.ReactNode }) {
  if (!visible && !isAdmin) return null;
  return (
    <>
      {!visible && isAdmin && (
        <p className="max-w-4xl mx-auto px-4 -mb-6 mt-6 text-center text-xs font-extrabold rounded-full py-1"
          style={{ background: "var(--input-bg)", color: "var(--muted)" }}>
          👁️ Hidden from guests — only you can see this section
        </p>
      )}
      {children}
    </>
  );
}

/* ===================== FAMILY KEEPSAKE (family code) ===================== */
// The family's private view: every reserved gift with who it's from, the note,
// the voice message, and the ecard (opened with a 3D flip). No date gate — a
// housewarming keepsake should be readable anytime.
function FamilyKeepsake({ event, night, onToggleTheme, onExit }: { event: EventDetails; night: boolean; onToggleTheme: () => void; onExit: () => void }) {
  const [gifts_, setGifts] = useState<Reveal[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Reveal | null>(null);

  useEffect(() => {
    gifts.reveal()
      .then(setGifts)
      .catch(() => setError(true));
  }, []);

  const cardMeta = (id: string) => ECARDS.find((c) => c.id === id);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3 floaty">🏡🎁</div>
        <h1 className="display font-bold leading-none" style={{ fontSize: "clamp(2.2rem, 8vw, 4.5rem)", color: "#C96F4A" }}>Welcome home, {event.familyName}!</h1>
        <p className="text-lg font-bold t-muted mt-2">Your housewarming gifts, cards, and messages 💝</p>
        <button onClick={onToggleTheme} className="btn-pop mt-3 px-4 py-2 rounded-full text-sm font-extrabold text-white shadow" style={{ background: night ? "#D9A441" : "#3d3226" }}>{night ? "☀️ Day" : "🌙 Night"}</button>
      </div>

      {error && <p className="t-muted font-bold text-center">Couldn't load your gifts — try again in a moment.</p>}
      {!error && gifts_ === null && <p className="t-muted font-bold text-center">Loading your gifts… 🎀</p>}
      {gifts_ !== null && gifts_.length === 0 && (
        <p className="t-muted font-bold text-center py-10">No gifts reserved yet — check back soon! 🏡</p>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {(gifts_ || []).map((g, i) => {
          const card = cardMeta(g.ecard_id);
          return (
            <button key={g.gift_id} onClick={() => setOpen(g)} className="surface card-hover rounded-3xl p-5 shadow-lg border-4 flex flex-col text-left" style={{ borderColor: (card?.accent || COLORS[i % COLORS.length]) + "55" }}>
              <Thumb src={g.image_url} alt={g.title} i={i} />
              <h3 className="display font-bold text-lg t-text">{g.title}</h3>
              <p className="font-extrabold text-sm mt-1" style={{ color: "#7D97B8" }}>From {g.claimed_by} 💌</p>
              {(g.ecard_id || g.ecard_custom_url) && (
                <p className="text-xs font-extrabold mt-1" style={{ color: card?.accent || "#C96F4A" }}>
                  {card ? `${card.emoji} ${card.label} card` : "🖼️ Custom card"}
                </p>
              )}
              {g.message && <p className="text-sm t-muted italic mt-1 line-clamp-2">"{g.message}"</p>}
              {g.voice_url && <p className="text-xs font-extrabold mt-1" style={{ color: "#C96F4A" }}>🎤 Voice message</p>}
              <span className="text-xs font-extrabold mt-2" style={{ color: "#D9A441" }}>Tap to open →</span>
            </button>
          );
        })}
      </div>

      {/* Card viewer: ecard flips open; plain notes get a simple sheet */}
      {open && (() => {
        const faces = open.ecard_id ? ECARD_FACES[open.ecard_id] : undefined;
        const insideContent = (
          <div style={{ width: "100%", height: "100%", overflow: "auto", background: "#FBF7F0", padding: "6% 7%", boxSizing: "border-box", textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <p style={{ fontFamily: "Georgia,serif", fontWeight: 700, color: "#3d3229", fontSize: "clamp(14px, 2.4vw, 22px)", marginBottom: 8 }}>
              For {event.familyName} — from {open.claimed_by} 💌
            </p>
            {open.message ? (
              <p style={{ fontFamily: "Georgia,serif", color: "#5c5044", fontSize: "clamp(13px, 2.1vw, 19px)", lineHeight: 1.5, fontStyle: "italic" }}>“{open.message}”</p>
            ) : (
              <p style={{ fontFamily: "Georgia,serif", color: "#a4917d", fontSize: "clamp(12px, 2vw, 16px)" }}>(No written note — the card says it all.)</p>
            )}
            {open.voice_url && <audio src={open.voice_url} controls style={{ width: "100%", marginTop: 12 }} />}
          </div>
        );
        return (
          <div onClick={() => setOpen(null)} className="fixed inset-0 z-[120] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.85)" }}>
            <div onClick={(e) => e.stopPropagation()} className="w-full flex justify-center">
              {faces || open.ecard_custom_url ? (
                <FlipCard
                  senderName={open.claimed_by}
                  onClose={() => setOpen(null)}
                  front={faces
                    ? <faces.Front name={event.familyName} />
                    : <img src={open.ecard_custom_url} alt="Card" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  inside={faces
                    ? <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        <div style={{ position: "absolute", inset: 0 }}><faces.Inside name={event.familyName} /></div>
                        {(open.message || open.voice_url) && (
                          <div style={{ position: "absolute", inset: 0, background: "rgba(251,247,240,.94)" }}>{insideContent}</div>
                        )}
                      </div>
                    : insideContent}
                />
              ) : (
                <div className="surface rounded-3xl p-6 shadow-2xl border-4 w-full max-w-md max-h-[90vh] overflow-auto text-center" style={{ borderColor: "#C96F4A" }}>
                  <Thumb src={open.image_url} alt={open.title} i={0} />
                  <h3 className="display font-bold text-xl t-text mt-2">{open.title}</h3>
                  <p className="font-extrabold mt-1" style={{ color: "#7D97B8" }}>From {open.claimed_by} 💌</p>
                  {open.message ? (
                    <p className="t-text font-semibold leading-relaxed rounded-2xl p-4 mt-4 text-left" style={{ background: "var(--input-bg)" }}>{open.message}</p>
                  ) : (
                    !open.voice_url && <p className="t-muted font-semibold mt-4">(No note with this gift.)</p>
                  )}
                  {open.voice_url && (
                    <div className="mt-4">
                      <p className="font-extrabold text-sm mb-1" style={{ color: "#C96F4A" }}>🎤 Voice message</p>
                      <audio src={open.voice_url} controls className="w-full" />
                    </div>
                  )}
                  <button onClick={() => setOpen(null)} className="btn-pop mt-4 px-6 py-2 rounded-full font-extrabold text-white" style={{ background: "#C96F4A" }}>Close ✕</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div className="text-center mt-10">
        <button onClick={onExit} className="text-sm font-bold t-muted underline">Exit</button>
      </div>
    </div>
  );
}

/* ===================== DECOR ===================== */
function Balloons() {
  // Soft floating lanterns in the housewarming palette.
  const spots = [
    { left: "5%", top: "12%", c: "#C96F4A", d: "0s" },
    { left: "88%", top: "20%", c: "#7D97B8", d: "1.2s" },
    { left: "78%", top: "60%", c: "#D9A441", d: ".6s" },
    { left: "10%", top: "70%", c: "#7C9A6D", d: "1.8s" },
  ];
  return (
    <>
      {spots.map((s, i) => (
        <span key={i} className="balloon floaty" aria-hidden
          style={{ left: s.left, top: s.top, background: s.c, animationDelay: s.d }} />
      ))}
    </>
  );
}

function PoolFloats() {
  // Day decoration for the pool theme: drifting pool rings + a beach ball.
  const rings = [
    { left: "6%", top: "14%", c: "#F2A65A", d: "0s", size: 56 },
    { left: "87%", top: "22%", c: "#1D9BB8", d: "1.2s", size: 48 },
    { left: "79%", top: "62%", c: "#EF7674", d: ".6s", size: 60 },
    { left: "9%", top: "72%", c: "#7FD3E6", d: "1.8s", size: 44 },
  ];
  return (
    <>
      {rings.map((r, i) => (
        <span key={i} className="floaty" aria-hidden
          style={{ position: "absolute", left: r.left, top: r.top, width: r.size, height: r.size,
            borderRadius: "50%", border: `${Math.round(r.size / 4)}px solid ${r.c}`, opacity: 0.5, animationDelay: r.d }} />
      ))}
      <span className="floaty" aria-hidden
        style={{ position: "absolute", left: "48%", top: "8%", width: 46, height: 46, borderRadius: "50%", opacity: 0.55, animationDelay: ".9s",
          background: "conic-gradient(#EF7674 0 60deg, #FDF3D6 60deg 120deg, #1D9BB8 120deg 180deg, #F2A65A 180deg 240deg, #FDF3D6 240deg 300deg, #7FD3E6 300deg 360deg)" }} />
    </>
  );
}

function NightSky() {
  const stars = useRef(
    Array.from({ length: 40 }, () => ({
      left: Math.random() * 100 + "%", top: Math.random() * 70 + "%",
      size: Math.random() * 2.5 + 1, delay: Math.random() * 3 + "s",
    }))
  ).current;
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map((s, i) => (
        <span key={i} className="star" style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }} />
      ))}
      <div className="absolute floaty" style={{ right: "8%", top: "10%", width: 70, height: 70, borderRadius: "50%",
        background: "radial-gradient(circle at 35% 35%, #fff7d6, #ffe79e)", animation: "glow 4s ease-in-out infinite" }} />
    </div>
  );
}

/* ===================== GATE ===================== */
function Gate({ pub, hostMode, onUnlock }: { pub: { familyName: string } | null; hostMode?: boolean; onUnlock: (role: Role) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Returning guests: sign in with the name + PIN from their RSVP (works even
  // when the guest passcode is switched off — approval is the requirement).
  const [pinMode, setPinMode] = useState(false);
  const [gName, setGName] = useState("");
  const [gPin, setGPin] = useState("");
  const submitPin = async () => {
    if (!gName.trim() || !gPin.trim()) return;
    setBusy(true); setError("");
    try {
      const mine = await authenticateGuestPin(gName.trim(), gPin.trim());
      try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch { /* ignore */ }
      onUnlock("guest");
    } catch (e: any) {
      setError(e?.body?.code === "not_approved"
        ? "Your RSVP hasn't been approved by the host yet — check back soon! ⏳"
        : "We couldn't match that name and PIN. Try the exact name you RSVP'd with. 🔎");
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true); setError("");
    try {
      const role = await authenticate(code.trim());
      if (hostMode && role !== "admin") {
        // /admin only opens for the host code; drop the token we just stored.
        logout();
        setError("That code works on the main page — this door needs the host code. 🛠️");
        return;
      }
      onUnlock(role);
    } catch (e: any) {
      setError(e?.body?.code === "guest_closed"
        ? "Guest entry is currently closed — check back soon! 🔒"
        : "Hmm, that code didn't work. Check your invite! 🎟️");
    } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="surface rounded-3xl p-8 shadow-xl border-4 max-w-sm w-full text-center bob" style={{ borderColor: "#F1E2CE" }}>
        <div className="text-5xl mb-3">{hostMode ? "🛠️🔒" : "🏡🔒"}</div>
        <h1 className="display font-bold text-2xl mb-1" style={{ color: "#C96F4A" }}>
          {hostMode ? "Host sign-in" : pub?.familyName ? `${pub.familyName} Housewarming` : "Housewarming Party"}
        </h1>
        <p className="t-muted font-bold mb-5">{hostMode ? "Enter the host code to open the controls." : pinMode ? "Sign in with the name and PIN from your RSVP." : "Enter the passcode from your invite to come in."}</p>
        {pinMode && !hostMode ? (
          <>
            <input value={gName} onChange={(e) => { setGName(e.target.value); setError(""); }}
              placeholder="Name on your RSVP"
              className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-bold text-center focus:outline-none"
              style={{ background: "var(--input-bg)", borderColor: "var(--input-border)" }} />
            <input value={gPin} onChange={(e) => { setGPin(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && submitPin()} placeholder="Your PIN" type="password" inputMode="numeric"
              className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-bold text-center focus:outline-none"
              style={{ background: "var(--input-bg)", borderColor: "var(--input-border)" }} />
            {error && <p className="text-red-500 font-bold mb-3 text-sm">{error}</p>}
            <button onClick={submitPin} disabled={busy}
              className="btn-pop w-full py-3.5 rounded-xl font-extrabold text-white text-lg shadow-md disabled:opacity-60" style={{ background: "#7C9A6D" }}>
              {busy ? "Checking…" : "Sign me in ✅"}
            </button>
            <button onClick={() => { setPinMode(false); setError(""); }} className="mt-3 text-sm font-bold t-muted underline">I have an invite passcode instead</button>
          </>
        ) : (
          <>
        <input
          value={code} onChange={(e) => { setCode(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={hostMode ? "Host / admin code" : "Housewarming passcode"}
          className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-bold text-center focus:outline-none"
          style={{ background: "var(--input-bg)", borderColor: "var(--input-border)" }}
        />
        {error && <p className="text-red-500 font-bold mb-3 text-sm">{error}</p>}
        <button onClick={submit} disabled={busy}
          className="btn-pop w-full py-3.5 rounded-xl font-extrabold text-white text-lg shadow-md disabled:opacity-60" style={{ background: "#C96F4A" }}>
          {busy ? "Checking…" : "Come on in! 🔑"}
        </button>
        {!hostMode && (
          <button onClick={() => { setPinMode(true); setError(""); }} className="mt-3 text-sm font-bold t-muted underline">
            Already RSVP'd? Sign in with your name + PIN
          </button>
        )}
          </>
        )}
      </div>
    </div>
  );
}

/* ===================== NAV ===================== */
function NavBar({ event, sections, isAdmin, night, onToggle }: { event: EventDetails; sections: SectionFlags; isAdmin: boolean; night: boolean; onToggle: () => void }) {
  const allLinks: [keyof SectionFlags, string, string][] = [
    ["details", "#details", "Details"], ["rsvp", "#rsvp", "RSVP"], ["food", "#food", "Food"],
    ["photos", "#photos", "Photos"], ["game", "#game", "Game"], ["gameCenter", "#game-center", "Games"], ["gifts", "#registry", "Registry"],
  ];
  const links = allLinks.filter(([key]) => sections[key] || isAdmin);
  return (
    <nav className="sticky top-0 z-50 backdrop-blur border-b" style={{ background: "var(--nav-bg)", borderColor: "var(--nav-border)" }}>
      <div className="max-w-4xl mx-auto px-3 py-3 flex items-center justify-between gap-2">
        <a href="#home" className="display text-lg sm:text-xl font-bold whitespace-nowrap" style={{ color: "#C96F4A" }}>🏡 {event.familyName}</a>
        <div className="flex items-center gap-0.5 sm:gap-2 text-xs sm:text-sm font-bold overflow-x-auto">
          {links.map(([, href, label]) => (
            <a key={href} href={href} className="px-2 py-1.5 rounded-full hover:bg-pink-100/30 transition-colors whitespace-nowrap t-text">{label}</a>
          ))}
          <button onClick={onToggle} aria-label="Toggle day or night theme"
            className="btn-pop ml-1 w-9 h-9 rounded-full flex items-center justify-center text-lg shadow"
            style={{ background: night ? "#D9A441" : "#3d3226", color: "#fff" }}>{night ? "☀️" : "🌙"}</button>
        </div>
      </div>
    </nav>
  );
}

/* ===================== HERO ===================== */
function Hero({ event }: { event: EventDetails }) {
  return (
    <header id="home" className="max-w-4xl mx-auto px-4 pt-12 pb-6 text-center relative">
      <div className="inline-block px-4 py-1.5 rounded-full text-sm font-extrabold mb-5 bob" style={{ background: "#D9A441", color: "#5a4310" }}>You're invited! ✨</div>
      <h1 className="display font-bold leading-none" style={{ fontSize: "clamp(2.4rem, 8vw, 5rem)", color: "#C96F4A" }}>{event.familyName}</h1>
      <div className="display font-bold floaty" style={{ fontSize: "clamp(3.4rem, 14vw, 7rem)", color: "#7C9A6D", lineHeight: 1.05, margin: "0.15em 0" }}>Home Sweet Home 🏡</div>
      <p className="text-lg sm:text-xl font-bold t-muted max-w-xl mx-auto">Come celebrate the new place with {event.tagline} — {fmtDate(event.partyDate)}.</p>
      <div className="mt-7 flex flex-wrap gap-3 justify-center">
        <a href="#rsvp" className="btn-pop px-7 py-3 rounded-full font-extrabold text-white text-lg shadow-lg" style={{ background: "#C96F4A" }}>RSVP now →</a>
        <a href="#registry" className="btn-pop px-7 py-3 rounded-full font-extrabold text-lg shadow-lg" style={{ background: "#7C9A6D", color: "#fff" }}>See the registry 🎁</a>
      </div>
    </header>
  );
}

/* ===================== COUNTDOWN ===================== */
function getRemaining(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return { done: true as const };
  const s = Math.floor(diff / 1000);
  return { done: false as const, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}
function Countdown({ partyDate }: { partyDate: string }) {
  const [t, setT] = useState(getRemaining(partyDate));
  useEffect(() => {
    const id = setInterval(() => setT(getRemaining(partyDate)), 1000);
    return () => clearInterval(id);
  }, [partyDate]);
  if (t.done) {
    return (
      <section className="max-w-4xl mx-auto px-4 py-6">
        <div className="rounded-3xl p-8 text-center text-white shadow-xl" style={{ background: "#7C9A6D" }}>
          <p className="display text-3xl sm:text-4xl font-bold">The doors are open — welcome home! 🏡🎉</p>
        </div>
      </section>
    );
  }
  const units: [string, number][] = [["Days", t.days], ["Hours", t.hours], ["Minutes", t.minutes], ["Seconds", t.seconds]];
  return (
    <section className="max-w-4xl mx-auto px-4 py-6">
      <p className="text-center font-extrabold t-muted mb-3 uppercase tracking-widest text-sm">Counting down to the housewarming</p>
      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        {units.map(([label, val], i) => (
          <div key={label} className="rounded-2xl py-4 text-center shadow-md text-white" style={{ background: COLORS[i] }}>
            <div className="display font-bold leading-none" style={{ fontSize: "clamp(1.8rem,7vw,3rem)" }}>{String(val).padStart(2, "0")}</div>
            <div className="text-xs sm:text-sm font-bold opacity-90 mt-1">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ===================== DETAILS ===================== */
function Details({ event, role, unlock }: { event: EventDetails; role: Role; unlock: AddressUnlock | null }) {
  // Effective address: the server redacts event.address for gated guests, and
  // hands it back through the unlock only once the host approves their RSVP.
  const locked = !!event.addressLocked && role === "guest";
  const address = locked ? (unlock?.approved ? unlock.address || "" : "") : event.address;
  const venueName = locked ? (unlock?.approved ? unlock.venueName || event.venueName : event.venueName) : event.venueName;
  const hasAddress = !!address;
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  const mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const rows: [string, string, string][] = [
    ["📅", "When", `${fmtDate(event.partyDate)} · ${event.timeLabel}`],
    ["📍", "Where", hasAddress ? `${venueName} — ${address}` : `${venueName} — address unlocks after the host approves your RSVP 🔒`],
    ["💌", "RSVP by", event.rsvpDeadline],
  ];
  return (
    <section id="details" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="🗓️" color="#7D97B8">Party Details</SectionTitle>
      <div className="grid md:grid-cols-2 gap-6 items-stretch">
        <div className="surface rounded-3xl p-6 shadow-lg border-4" style={{ borderColor: "#E7EAD9" }}>
          <ul className="space-y-5">
            {rows.map(([e, k, v]) => (
              <li key={k} className="flex gap-4">
                <span className="text-3xl">{e}</span>
                <div>
                  <div className="font-extrabold t-muted text-sm uppercase tracking-wide">{k}</div>
                  <div className="font-bold t-text">{v}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 t-text font-semibold leading-relaxed rounded-2xl p-4" style={{ background: "var(--input-bg)" }}>{event.hostNote}</p>
        </div>
        {hasAddress ? (
          <div className="rounded-3xl overflow-hidden shadow-lg border-4 flex flex-col" style={{ borderColor: "#F1E2CE" }}>
            <iframe title="Party location map" src={mapSrc} className="w-full grow" style={{ border: 0, minHeight: 260 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <a href={mapLink} target="_blank" rel="noreferrer" className="btn-pop block text-center font-extrabold py-3 text-white" style={{ background: "#9A6B4F" }}>Open in Maps 🧭</a>
          </div>
        ) : (
          <div className="surface rounded-3xl shadow-lg border-4 flex flex-col items-center justify-center text-center p-8" style={{ borderColor: "#F1E2CE", minHeight: 300 }}>
            {unlock ? (
              <>
                <div className="text-5xl mb-3 floaty">⏳</div>
                <p className="display font-bold text-xl t-text mb-1">Your RSVP is in!</p>
                <p className="t-muted font-semibold max-w-xs">The host reviews RSVPs personally — the address and directions unlock right here once yours is approved.</p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-3 floaty">🔒</div>
                <p className="display font-bold text-xl t-text mb-1">Address unlocks after you RSVP</p>
                <p className="t-muted font-semibold max-w-xs mb-4">Send your RSVP below — once the host approves it, the address and directions appear here.</p>
                <a href="#rsvp" className="btn-pop px-6 py-2.5 rounded-full font-extrabold text-white shadow" style={{ background: "#C96F4A" }}>RSVP now →</a>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ===================== RSVP ===================== */
const STATUS_META: Record<RsvpStatus, { label: string; icon: string; bg: string }> = {
  yes: { label: "Yes 🎉", icon: "✅", bg: "#7C9A6D" },
  maybe: { label: "Maybe 🤔", icon: "🤔", bg: "#D9A441" },
  no: { label: "No 😢", icon: "🚫", bg: "#C98A8A" },
};

function RSVP({ refreshKey, isAdmin, addressGated, onUnlockChange }: { refreshKey: number; isAdmin: boolean; addressGated: boolean; onUnlockChange: () => void }) {
  const [name, setName] = useState("");
  const [count, setCount] = useState("");
  const [status, setStatus] = useState<RsvpStatus>("yes");
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [list, setList] = useState<Rsvp[]>([]);
  const [guestView, setGuestView] = useState<GuestListView | null>(null); // guests: names + headcount only
  const [selfEntry, setSelfEntry] = useState<RsvpSelf | null>(null); // guests: own row via edit token
  const [loading, setLoading] = useState(true);
  // Cross-device recovery (name + PIN)
  const [recovering, setRecovering] = useState(false);
  const [recName, setRecName] = useState("");
  const [recPin, setRecPin] = useState("");
  const [recError, setRecError] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; status: RsvpStatus; partySize: number; message: string; email: string; phone: string }>(
    { name: "", status: "yes", partySize: 1, message: "", email: "", phone: "" }
  );
  // The RSVP this device created (id + secret token), so the guest can edit it later.
  const [mine, setMine] = useState<{ id: string; editToken: string } | null>(null);
  const [editingMine, setEditingMine] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await rsvps.list();
      if (Array.isArray(data)) {
        setList(data); setGuestView(null);
        // Reconcile our saved RSVP: forget it if the host has cleared/removed it.
        try {
          const raw = localStorage.getItem(MINE_KEY);
          if (raw) {
            const saved = JSON.parse(raw) as { id: string; editToken: string };
            if (data.some((r) => r.id === saved.id)) setMine(saved);
            else { localStorage.removeItem(MINE_KEY); setMine(null); }
          }
        } catch { /* ignore */ }
      } else {
        // Guest view: names + headcount only. We can't check membership here —
        // the self-fetch below validates the saved RSVP (and clears it on 404).
        setGuestView(data); setList([]);
        try {
          const raw = localStorage.getItem(MINE_KEY);
          if (raw) setMine(JSON.parse(raw) as { id: string; editToken: string });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  // Guests can't find themselves in the redacted list — fetch their own row
  // with the edit token instead. Admin/family still derive it from the list.
  useEffect(() => {
    if (!guestView || !mine) { setSelfEntry(null); return; }
    let alive = true;
    rsvps.access(mine.id, mine.editToken)
      .then((r) => { if (alive) setSelfEntry(r.self ?? null); })
      .catch((e: any) => {
        if (!alive) return;
        setSelfEntry(null);
        if (e?.status === 404) { try { localStorage.removeItem(MINE_KEY); } catch { /* ignore */ } setMine(null); }
      });
    return () => { alive = false; };
  }, [guestView, mine, refreshKey]);

  const myEntry: Rsvp | RsvpSelf | null = guestView
    ? selfEntry
    : mine ? list.find((r) => r.id === mine.id) || null : null;

  // Load my current values into the form to edit them.
  const beginEditMine = () => {
    if (!myEntry) return;
    setName(myEntry.name);
    setStatus(myEntry.status);
    setCount(myEntry.status === "no" ? "" : String(myEntry.party_size || ""));
    setMsg(myEntry.message || "");
    setEmail(myEntry.email || "");
    setPhone(myEntry.phone || "");
    setError("");
    setEditingMine(true);
    document.getElementById("rsvp")?.scrollIntoView({ behavior: "smooth" });
  };
  const cancelEditMine = () => {
    setEditingMine(false);
    setName(""); setMsg(""); setEmail(""); setPhone(""); setCount(""); setStatus("yes"); setError("");
  };

  // Cross-device: find my RSVP by name + PIN, then load it for editing.
  const findMine = async () => {
    setRecError("");
    if (!recName.trim() || !recPin.trim()) { setRecError("Enter your name and PIN."); return; }
    setRecBusy(true);
    try {
      const found = await rsvps.lookup(recName.trim(), recPin.trim());
      const saved = { id: found.id, editToken: found.editToken };
      try { localStorage.setItem(MINE_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
      onUnlockChange(); // re-check whether this recovered RSVP already has address access
      setMine(saved);
      setName(found.name);
      setStatus(found.status);
      setCount(found.status === "no" ? "" : String(found.party_size || ""));
      setMsg(found.message || ""); setEmail(found.email || ""); setPhone(found.phone || "");
      setEditingMine(true);
      setRecovering(false); setRecName(""); setRecPin("");
      await load();
      document.getElementById("rsvp")?.scrollIntoView({ behavior: "smooth" });
    } catch (e: any) {
      setRecError(e?.body?.error || "Couldn't find that RSVP.");
    } finally { setRecBusy(false); }
  };

  // Admin: flip approval; this is what unlocks/locks the address for that guest.
  const toggleApprove = async (r: Rsvp) => {
    try { await rsvps.approve(r.id, !r.approved); await load(); } catch { /* ignore */ }
  };

  const startEdit = (r: Rsvp) => {
    setEditId(r.id);
    setEdit({ name: r.name, status: r.status, partySize: r.party_size || 1, message: r.message || "", email: r.email || "", phone: r.phone || "" });
  };
  const saveEdit = async () => {
    if (!editId || !edit.name.trim()) return;
    try { await rsvps.update(editId, { ...edit, name: edit.name.trim() }); setEditId(null); await load(); } catch { /* ignore */ }
  };
  const removeRsvp = async (r: Rsvp) => {
    if (!window.confirm(`Delete the RSVP from "${r.name}"? This can't be undone.`)) return;
    try { await rsvps.remove(r.id); await load(); } catch { /* ignore */ }
  };

  const submit = async () => {
    setError("");
    if (!name.trim()) { setError("Please add your name 🙂"); return; }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError("That email doesn't look right 📧"); return; }
    setSubmitting(true);
    try {
      const partySize = count.trim() === "" ? 1 : Math.max(1, parseInt(count, 10) || 1);
      const payload = { name: name.trim(), status, partySize, message: msg.trim(), email: email.trim(), phone: phone.trim() };
      if (editingMine && mine) {
        // Update this device's existing RSVP using the secret token.
        await rsvps.updateSelf(mine.id, mine.editToken, payload);
        setEditingMine(false);
      } else {
        const created = await rsvps.create({ ...payload, pin: pin.trim() || undefined });
        const saved = { id: created.id, editToken: created.editToken };
        try { localStorage.setItem(MINE_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
        onUnlockChange(); // the Details section flips to its "awaiting approval" state
        setMine(saved);
      }
      setName(""); setMsg(""); setEmail(""); setPhone(""); setCount(""); setStatus("yes"); setPin("");
      if (status !== "no") fireConfetti();
      await load();
    } catch { setError("Couldn't save your RSVP — please try again."); } finally { setSubmitting(false); }
  };

  const guestsComing = guestView ? guestView.totalGoing : list.filter((r) => r.status === "yes").reduce((s, r) => s + (r.party_size || 0), 0);
  const maybeCount = list.filter((r) => r.status === "maybe").length;
  const inputCls = "w-full mb-4 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none";
  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;
  const editStyle = { background: "var(--surface)", borderColor: "var(--input-border)" } as const;

  return (
    <section id="rsvp" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="💌" color="#C96F4A">Will you be there?</SectionTitle>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="surface rounded-3xl p-6 shadow-lg border-4" style={{ borderColor: "#F1E2CE" }}>
          {myEntry && !editingMine && (
            <div className="rounded-2xl p-4 mb-4 pop" style={{ background: "var(--input-bg)" }}>
              <p className="font-extrabold t-text">You're on the list as {myEntry.name} {STATUS_META[myEntry.status]?.icon}</p>
              {addressGated && (
                myEntry.approved
                  ? <p className="text-sm font-extrabold mb-1" style={{ color: "#7C9A6D" }}>Approved by the host — the address is unlocked in Party Details ✓</p>
                  : <p className="text-sm font-extrabold mb-1" style={{ color: "#D9A441" }}>Awaiting host approval — the address unlocks once you're approved ⏳</p>
              )}
              <p className="text-sm font-semibold t-muted mb-3">Need to change your reply or headcount?</p>
              <button onClick={beginEditMine} className="btn-pop w-full py-2.5 rounded-xl font-extrabold text-white text-sm shadow" style={{ background: "#7D97B8" }}>Edit my RSVP ✏️</button>
            </div>
          )}
          {editingMine && (
            <div className="rounded-2xl px-4 py-3 mb-4 flex items-center justify-between gap-2" style={{ background: "var(--input-bg)" }}>
              <span className="font-extrabold text-sm t-text">Editing your RSVP</span>
              <button onClick={cancelEditMine} className="text-xs font-bold t-muted underline shrink-0">cancel</button>
            </div>
          )}
          <label className="block font-extrabold t-muted mb-1">Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Garcia Family" className={inputCls} style={inputStyle} />
          <label className="block font-extrabold t-muted mb-2">Can you make it?</label>
          <div className="flex gap-2 mb-4">
            {(["yes", "maybe", "no"] as const).map((val) => (
              <button key={val} onClick={() => setStatus(val)} className="btn-pop flex-1 py-3 rounded-xl font-extrabold border-2 transition-colors text-sm sm:text-base"
                style={status === val
                  ? { background: STATUS_META[val].bg, borderColor: "transparent", color: val === "maybe" ? "#5a4310" : "#fff" }
                  : { background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--muted)" }}>
                {STATUS_META[val].label}
              </button>
            ))}
          </div>
          {status !== "no" && (
            <div className="mb-4 pop">
              <label className="block font-extrabold t-muted mb-1">How many guests?</label>
              <input type="number" min={1} max={20} value={count} placeholder="1" onChange={(e) => setCount(e.target.value)}
                className="w-28 px-4 py-3 rounded-xl border-2 font-bold focus:outline-none" style={inputStyle} />
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-0 sm:gap-3">
            <div>
              <label className="block font-extrabold t-muted mb-1">Email <span className="font-semibold opacity-70">(optional)</span></label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block font-extrabold t-muted mb-1">Phone <span className="font-semibold opacity-70">(optional)</span></label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className={inputCls} style={inputStyle} />
            </div>
          </div>
          <label className="block font-extrabold t-muted mb-1">Message (optional)</label>
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="Anything we should know? Allergies, etc." className={inputCls} style={inputStyle} />
          {!editingMine && (
            <>
              <label className="block font-extrabold t-muted mb-1">Set a PIN <span className="font-semibold opacity-70">(recommended — once you're approved, your name + PIN signs you back in from any device)</span></label>
              <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="e.g. 1234" maxLength={20} className={inputCls} style={inputStyle} />
            </>
          )}
          {error && <p className="text-red-500 font-bold mb-3">{error}</p>}
          <button onClick={submit} disabled={submitting} className="btn-pop w-full py-3.5 rounded-xl font-extrabold text-white text-lg shadow-md disabled:opacity-60" style={{ background: "#C96F4A" }}>
            {submitting ? "Saving…" : editingMine ? "Update my RSVP ✅" : "Send RSVP 🎈"}
          </button>

          {!editingMine && (
            <div className="mt-3 text-center">
              {!recovering ? (
                <button onClick={() => { setRecovering(true); setRecError(""); }} className="text-xs font-bold t-muted underline">
                  Already RSVP'd on another device? Edit it →
                </button>
              ) : (
                <div className="rounded-2xl p-4 mt-2 text-left pop" style={{ background: "var(--input-bg)" }}>
                  <p className="font-extrabold t-text text-sm mb-2">Find your RSVP</p>
                  <input value={recName} onChange={(e) => setRecName(e.target.value)} placeholder="Your name (as you entered it)"
                    className="w-full mb-2 px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                  <input value={recPin} onChange={(e) => setRecPin(e.target.value)} placeholder="Your PIN"
                    className="w-full mb-2 px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                  {recError && <p className="text-red-500 font-bold text-sm mb-2">{recError}</p>}
                  <div className="flex gap-2">
                    <button onClick={findMine} disabled={recBusy} className="btn-pop flex-1 py-2 rounded-lg font-extrabold text-white text-sm disabled:opacity-60" style={{ background: "#7D97B8" }}>{recBusy ? "Looking…" : "Find my RSVP"}</button>
                    <button onClick={() => { setRecovering(false); setRecError(""); }} className="btn-pop px-3 py-2 rounded-lg font-bold text-sm t-muted" style={{ background: "var(--surface)" }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="surface rounded-3xl p-6 shadow-lg border-4" style={{ borderColor: "#E7EAD9" }}>
          <div className="rounded-2xl p-4 mb-4 text-center text-white" style={{ background: "#7D97B8" }}>
            <div className="display text-4xl font-bold">{guestsComing}</div>
            <div className="font-bold opacity-90">friends coming so far!{maybeCount > 0 ? ` (+${maybeCount} maybe)` : ""}</div>
          </div>
          {loading ? <p className="t-muted font-bold text-center py-6">Loading replies…</p>
            : guestView ? (
              guestView.names.length === 0
                ? <p className="t-muted font-bold text-center py-6">Be the first to RSVP! 🥳</p>
                : (
                  <>
                    <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Who's coming 🎉</p>
                    <ul className="flex flex-wrap gap-2 max-h-72 overflow-auto pr-1">
                      {guestView.names.map((n, i) => (
                        <li key={i} className="px-3 py-1.5 rounded-full font-bold text-sm" style={{ background: "var(--input-bg)" }}>{n}</li>
                      ))}
                    </ul>
                  </>
                )
            )
            : list.length === 0 ? <p className="t-muted font-bold text-center py-6">Be the first to RSVP! 🥳</p>
            : (
              <ul className="space-y-2 max-h-72 overflow-auto pr-1">
                {list.map((r) => (
                  <li key={r.id} className="rounded-xl px-3 py-2" style={{ background: "var(--input-bg)" }}>
                    {isAdmin && editId === r.id ? (
                      <div className="pop space-y-2">
                        <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Name"
                          className="w-full px-3 py-2 rounded-lg border-2 font-bold text-sm focus:outline-none" style={editStyle} />
                        <div className="flex gap-1">
                          {(["yes", "maybe", "no"] as const).map((val) => (
                            <button key={val} onClick={() => setEdit({ ...edit, status: val })} className="btn-pop flex-1 py-1.5 rounded-lg font-extrabold border-2 text-xs"
                              style={edit.status === val
                                ? { background: STATUS_META[val].bg, borderColor: "transparent", color: val === "maybe" ? "#5a4310" : "#fff" }
                                : { background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--muted)" }}>
                              {STATUS_META[val].label}
                            </button>
                          ))}
                        </div>
                        {edit.status !== "no" && (
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-extrabold t-muted">Guests</label>
                            <input type="number" min={1} max={20} value={edit.partySize} onChange={(e) => setEdit({ ...edit, partySize: parseInt(e.target.value || "1", 10) })}
                              className="w-20 px-2 py-1.5 rounded-lg border-2 font-bold text-sm focus:outline-none" style={editStyle} />
                          </div>
                        )}
                        <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="Email (optional)"
                          className="w-full px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                        <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="Phone (optional)"
                          className="w-full px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                        <textarea value={edit.message} onChange={(e) => setEdit({ ...edit, message: e.target.value })} rows={2} placeholder="Message (optional)"
                          className="w-full px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                        <div className="flex gap-2">
                          <button onClick={saveEdit} className="btn-pop flex-1 py-2 rounded-lg font-extrabold text-white text-sm" style={{ background: "#7C9A6D" }}>Save</button>
                          <button onClick={() => setEditId(null)} className="btn-pop px-3 py-2 rounded-lg font-bold text-sm t-muted" style={{ background: "var(--surface)" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{STATUS_META[r.status]?.icon ?? "✅"}</span>
                        <div className="min-w-0 grow">
                          <div className="font-extrabold t-text truncate">{r.name}</div>
                          {r.status !== "no" && <div className="text-sm font-bold t-muted">{r.party_size} guest{r.party_size > 1 ? "s" : ""}{r.status === "maybe" ? " · maybe" : ""}</div>}
                          {r.message && <div className="text-sm t-muted italic truncate">“{r.message}”</div>}
                          {isAdmin && (r.email || r.phone) && (
                            <div className="text-xs font-bold mt-0.5" style={{ color: "#7D97B8" }}>
                              {r.email && <span className="mr-2">📧 {r.email}</span>}
                              {r.phone && <span>📱 {r.phone}</span>}
                            </div>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex flex-col gap-1 shrink-0 text-right items-end">
                            <button onClick={() => toggleApprove(r)}
                              className="btn-pop text-[11px] font-extrabold px-2 py-0.5 rounded-full text-white"
                              style={{ background: r.approved ? "#7C9A6D" : "#D9A441", color: r.approved ? "#fff" : "#5a4310" }}
                              title={r.approved ? "Revoke address access" : "Approve — unlocks the address for this guest"}>
                              {r.approved ? "Approved ✓" : "Approve?"}
                            </button>
                            <button onClick={() => startEdit(r)} className="text-xs font-bold t-muted underline">Edit</button>
                            <button onClick={() => removeRsvp(r)} className="text-xs font-bold text-red-400 underline">Delete</button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          <p className="text-xs t-muted font-semibold mt-3 text-center">
            Names are visible to everyone.{isAdmin ? " Contact info is shown to you only." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ===================== DISH SIGNUP ===================== */
function DishSignup({ categories, isAdmin, refreshKey }: { categories: string[]; isAdmin: boolean; refreshKey: number }) {
  const [category, setCategory] = useState(categories[0] || "");
  const [name, setName] = useState("");
  const [dish, setDish] = useState("");
  const [list, setList] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ category: string; name: string; dish: string }>({ category: "", name: "", dish: "" });

  const load = useCallback(async () => {
    try { setList(await potluck.list()); } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const add = async () => {
    if (!name.trim() || !dish.trim()) return;
    setSubmitting(true);
    try { await potluck.create({ category, name: name.trim(), dish: dish.trim() }); setName(""); setDish(""); fireConfetti(); await load(); }
    catch { /* ignore */ } finally { setSubmitting(false); }
  };
  const remove = async (id: string) => { try { await potluck.remove(id); await load(); } catch { /* ignore */ } };
  const startEdit = (d: Dish) => { setEditId(d.id); setEdit({ category: d.category, name: d.name, dish: d.dish }); };
  const saveEdit = async () => {
    if (!editId || !edit.name.trim() || !edit.dish.trim()) return;
    try { await potluck.update(editId, { category: edit.category, name: edit.name.trim(), dish: edit.dish.trim() }); setEditId(null); await load(); }
    catch { /* ignore */ }
  };
  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;
  const editStyle = { background: "var(--surface)", borderColor: "var(--input-border)" } as const;

  return (
    <section id="food" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="🍽️" color="#D9A441">Bring a Dish</SectionTitle>
      <p className="text-center font-bold t-muted mb-6 max-w-xl mx-auto">It's a potluck! Sign up for what you'll bring so we get a little of everything. 🥗🍪</p>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="surface rounded-3xl p-6 shadow-lg border-4 h-fit" style={{ borderColor: "#F0E6CE" }}>
          <label className="block font-extrabold t-muted mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full mb-4 px-4 py-3 rounded-xl border-2 font-bold focus:outline-none" style={inputStyle}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="block font-extrabold t-muted mb-1">Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aunt Maria" className="w-full mb-4 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
          <label className="block font-extrabold t-muted mb-1">What are you bringing?</label>
          <input value={dish} onChange={(e) => setDish(e.target.value)} placeholder="e.g. Veggie tray + dip" className="w-full mb-4 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
          <button onClick={add} disabled={submitting} className="btn-pop w-full py-3.5 rounded-xl font-extrabold text-lg shadow-md disabled:opacity-60" style={{ background: "#D9A441", color: "#5a4310" }}>
            {submitting ? "Adding…" : "Add to the table 🍴"}
          </button>
        </div>
        <div className="surface rounded-3xl p-6 shadow-lg border-4" style={{ borderColor: "#F1E2CE" }}>
          {loading ? <p className="t-muted font-bold text-center py-6">Loading the menu…</p>
            : list.length === 0 ? <p className="t-muted font-bold text-center py-6">Nothing yet — add the first dish! 🍲</p>
            : (
              <div className="space-y-4 max-h-96 overflow-auto pr-1">
                {categories.map((cat) => {
                  const items = list.filter((d) => d.category === cat);
                  if (!items.length) return null;
                  return (
                    <div key={cat}>
                      <h4 className="display font-bold mb-1" style={{ color: "#C0563B" }}>{cat}</h4>
                      <ul className="space-y-1.5">
                        {items.map((d) => (
                          <li key={d.id} className="rounded-xl px-3 py-2" style={{ background: "var(--input-bg)" }}>
                            {isAdmin && editId === d.id ? (
                              <div className="pop space-y-2">
                                <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                                  className="w-full px-3 py-2 rounded-lg border-2 font-bold text-sm focus:outline-none" style={editStyle}>
                                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input value={edit.dish} onChange={(e) => setEdit({ ...edit, dish: e.target.value })} placeholder="Dish"
                                  className="w-full px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Name"
                                  className="w-full px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={editStyle} />
                                <div className="flex gap-2">
                                  <button onClick={saveEdit} className="btn-pop flex-1 py-2 rounded-lg font-extrabold text-white text-sm" style={{ background: "#7C9A6D" }}>Save</button>
                                  <button onClick={() => setEditId(null)} className="btn-pop px-3 py-2 rounded-lg font-bold text-sm t-muted" style={{ background: "var(--surface)" }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0"><span className="font-extrabold t-text">{d.dish}</span><span className="t-muted font-semibold text-sm"> — {d.name}</span></div>
                                <div className="flex gap-2 shrink-0">
                                  {isAdmin && <button onClick={() => startEdit(d)} className="text-xs font-bold t-muted underline">edit</button>}
                                  <button onClick={() => remove(d.id)} className="text-xs font-bold t-muted hover:text-red-400 underline">{isAdmin ? "delete" : "undo"}</button>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          <p className="text-xs t-muted font-semibold mt-3 text-center">The menu is visible to everyone who visits this page.</p>
        </div>
      </div>
    </section>
  );
}

/* ===================== GALLERY ===================== */
function Gallery({ isAdmin, partyDate, refreshKey }: { isAdmin: boolean; partyDate: string; refreshKey: number }) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ file: File; preview: string; caption: string }[]>([]);
  const [uploader, setUploader] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const touchX = useRef<number | null>(null);

  const active = activeIdx != null ? photos[activeIdx] ?? null : null;

  const load = useCallback(async () => {
    try { setPhotos(await gallery.list()); } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const showPrev = useCallback(() => setActiveIdx((i) => (i == null || photos.length === 0 ? i : (i - 1 + photos.length) % photos.length)), [photos.length]);
  const showNext = useCallback(() => setActiveIdx((i) => (i == null || photos.length === 0 ? i : (i + 1) % photos.length)), [photos.length]);

  useEffect(() => {
    if (activeIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveIdx(null);
      else if (e.key === "ArrowLeft") showPrev();
      else if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIdx, showPrev, showNext]);

  // Swipe left/right on touch devices.
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 50) { if (dx < 0) showNext(); else showPrev(); }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // let the same files be re-picked later
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) { setNotice("Please choose image files."); return; }
    setNotice(imgs.length < files.length ? "Some files were skipped (not images)." : "");
    setPicked((prev) => {
      if (prev.length === 0) setUploader("");
      return [...prev, ...imgs.map((f) => ({ file: f, preview: URL.createObjectURL(f), caption: "" }))];
    });
  };

  const setItemCaption = (idx: number, val: string) =>
    setPicked((prev) => prev.map((p, i) => (i === idx ? { ...p, caption: val } : p)));
  const removePicked = (idx: number) =>
    setPicked((prev) => { const p = prev[idx]; if (p) URL.revokeObjectURL(p.preview); return prev.filter((_, i) => i !== idx); });
  const closeUpload = () => { picked.forEach((p) => URL.revokeObjectURL(p.preview)); setPicked([]); setProgress(""); };

  const submit = async () => {
    if (picked.length === 0) return;
    setBusy(true); setNotice("");
    let done = 0, pending = 0, failed = 0;
    for (let i = 0; i < picked.length; i++) {
      setProgress(`Uploading ${i + 1} of ${picked.length}…`);
      try {
        const url = await uploadImage(picked[i].file);
        const saved = await gallery.add({ url, caption: picked[i].caption.trim(), uploadedBy: uploader.trim() });
        done++; if (!saved.approved) pending++;
      } catch { failed++; }
    }
    picked.forEach((p) => URL.revokeObjectURL(p.preview));
    setPicked([]); setProgress(""); setBusy(false);
    let msg = done > 0 ? `Shared ${done} photo${done !== 1 ? "s" : ""}! 🎉` : "";
    if (pending > 0) msg += ` ${pending} sent to the host for approval.`;
    if (failed > 0) msg += ` ${failed} didn't upload — please try again.`;
    setNotice(msg.trim());
    await load();
  };

  const approve = async (id: string) => { try { await gallery.approve(id); await load(); } catch { /* ignore */ } };
  const remove = async (id: string) => {
    if (!window.confirm("Remove this photo from the gallery?")) return;
    try { await gallery.remove(id); await load(); } catch { /* ignore */ }
  };

  const importCloud = async () => {
    setBusy(true); setNotice("");
    try {
      const { imported } = await gallery.importFromCloudinary();
      setNotice(imported > 0 ? `Imported ${imported} photo${imported > 1 ? "s" : ""} from Cloudinary. 🎉` : "No new photos to import.");
      await load();
    } catch (e: any) {
      setNotice(e?.body?.error || "Import failed — check the server's Cloudinary credentials.");
    } finally { setBusy(false); }
  };

  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;

  // Guest uploads unlock at the start of party day; the admin can upload/seed anytime.
  const uploadsOpenAt = (() => { const d = new Date(partyDate); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const uploadsOpen = isAdmin || Date.now() >= uploadsOpenAt;

  return (
    <section id="photos" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="📸" color="#9A6B4F">Photo Gallery</SectionTitle>

      {cloudinaryConfigured && uploadsOpen ? (
        <div className="text-center mb-4 flex flex-wrap gap-2 justify-center">
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
          <button onClick={() => fileRef.current?.click()} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg" style={{ background: "#9A6B4F" }}>📷 Add photos</button>
          {isAdmin && <button onClick={importCloud} disabled={busy} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg disabled:opacity-60" style={{ background: "#7D97B8" }}>{busy ? "Importing…" : "⤵️ Import from Cloudinary"}</button>}
        </div>
      ) : cloudinaryConfigured && !uploadsOpen ? (
        <div className="text-center mb-4">
          <p className="font-extrabold t-text rounded-2xl py-3 px-4 inline-block" style={{ background: "var(--input-bg)" }}>
            📸 Photo sharing opens on party day — {fmtDate(partyDate)}. Check back then to add your pics! 🎉
          </p>
        </div>
      ) : isAdmin ? (
        <div className="text-center mb-4">
          <p className="t-muted font-semibold text-sm mb-2">Photo uploads aren't set up yet — add your Cloudinary keys (VITE_CLOUDINARY_*) to enable guest uploads.</p>
          <button onClick={importCloud} disabled={busy} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg disabled:opacity-60" style={{ background: "#7D97B8" }}>{busy ? "Importing…" : "⤵️ Import existing Cloudinary photos"}</button>
        </div>
      ) : null}

      {notice && <p className="text-center font-bold text-sm mb-4" style={{ color: "#C0563B" }}>{notice}</p>}
      {loading && <p className="t-muted font-bold text-center mb-4">Loading photos…</p>}
      {!loading && photos.length === 0 && <p className="t-muted font-bold text-center mb-4">No photos yet{cloudinaryConfigured && uploadsOpen ? " — be the first to add one! 📷" : "."}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        {photos.map((p, i) => (
          <div key={p.id} className="relative rounded-2xl overflow-hidden shadow-lg aspect-square" style={{ background: COLORS[i % COLORS.length] }}>
            <button onClick={() => setActiveIdx(i)} className="card-hover block w-full h-full text-left">
              <img src={thumbUrl(p.url)} alt={p.caption || "Party photo"} loading="lazy" className="w-full h-full object-cover" />
              {(p.caption || p.uploaded_by) && (
                <span className="absolute bottom-0 inset-x-0 p-2 text-xs sm:text-sm font-bold text-white" style={{ background: "linear-gradient(transparent, rgba(0,0,0,.6))" }}>
                  {p.caption}{p.uploaded_by ? ` — ${p.uploaded_by}` : ""}
                </span>
              )}
            </button>
            {!p.approved && <span className="absolute top-1 left-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: "#C0563B" }}>Pending</span>}
            {isAdmin && (
              <div className="absolute top-1 right-1 flex gap-1">
                {!p.approved && <button onClick={() => approve(p.id)} className="btn-pop text-[10px] font-extrabold px-2 py-1 rounded-full text-white shadow" style={{ background: "#7C9A6D" }}>Approve</button>}
                <button onClick={() => remove(p.id)} className="btn-pop text-[10px] font-extrabold px-2 py-1 rounded-full text-white shadow" style={{ background: "#C96F4A" }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {active && (
        <div onClick={() => setActiveIdx(null)} className="fixed inset-0 z-[100] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.85)" }}>
          <div className="max-w-2xl w-full text-center relative" onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <img src={active.url} alt={active.caption || "Party photo"} className="w-full max-h-[75vh] object-contain rounded-2xl select-none" />
            {(active.caption || active.uploaded_by) && <p className="text-white font-bold mt-3 text-lg">{active.caption}{active.uploaded_by ? ` — ${active.uploaded_by}` : ""}</p>}
            {photos.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); showPrev(); }} aria-label="Previous photo"
                  className="btn-pop absolute left-1 sm:-left-14 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-2xl font-extrabold text-white shadow-lg" style={{ background: "rgba(0,0,0,.55)" }}>‹</button>
                <button onClick={(e) => { e.stopPropagation(); showNext(); }} aria-label="Next photo"
                  className="btn-pop absolute right-1 sm:-right-14 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-2xl font-extrabold text-white shadow-lg" style={{ background: "rgba(0,0,0,.55)" }}>›</button>
                <p className="text-white/70 font-bold text-sm mt-2">{(activeIdx ?? 0) + 1} / {photos.length}</p>
              </>
            )}
            <button onClick={() => setActiveIdx(null)} className="btn-pop mt-3 px-6 py-2 rounded-full font-extrabold text-white" style={{ background: "#C96F4A" }}>Close ✕</button>
          </div>
        </div>
      )}

      {/* Upload form (multi-photo) */}
      {picked.length > 0 && (
        <div onClick={() => !busy && closeUpload()} className="fixed inset-0 z-[110] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.8)" }}>
          <div onClick={(e) => e.stopPropagation()} className="surface rounded-3xl p-6 shadow-2xl border-4 w-full max-w-md max-h-[90vh] overflow-auto" style={{ borderColor: "#9A6B4F" }}>
            <h3 className="display font-bold text-xl mb-1" style={{ color: "#9A6B4F" }}>Add photos ({picked.length})</h3>
            <p className="t-muted font-semibold text-sm mb-3">Add an optional caption to each, then your name — and share them all at once.</p>
            <div className="space-y-2 max-h-[40vh] overflow-auto mb-3">
              {picked.map((p, idx) => (
                <div key={idx} className="flex gap-2 items-center rounded-xl p-2" style={{ background: "var(--input-bg)" }}>
                  <img src={p.preview} alt="preview" className="w-16 h-16 object-cover rounded-lg shrink-0" />
                  <input value={p.caption} onChange={(e) => setItemCaption(idx, e.target.value)} placeholder="Caption (optional)" className="flex-1 px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={inputStyle} />
                  <button onClick={() => removePicked(idx)} disabled={busy} className="btn-pop shrink-0 w-8 h-8 rounded-full font-extrabold text-white" style={{ background: "#C96F4A" }}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-pop w-full mb-3 py-2 rounded-xl font-bold text-sm border-2" style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--muted)" }}>＋ Add more photos</button>
            <label className="block font-extrabold t-muted mb-1 text-sm">Your name (optional)</label>
            <input value={uploader} onChange={(e) => setUploader(e.target.value)} placeholder="e.g. Aunt Maria" className="w-full mb-4 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="btn-pop flex-1 py-3 rounded-xl font-extrabold text-white shadow-md disabled:opacity-60" style={{ background: "#7C9A6D" }}>{busy ? (progress || "Uploading…") : `Share ${picked.length} photo${picked.length > 1 ? "s" : ""} 📤`}</button>
              <button onClick={closeUpload} disabled={busy} className="btn-pop px-5 py-3 rounded-xl font-bold t-muted" style={{ background: "var(--input-bg)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================== WISHLIST ===================== */
function Thumb({ src, alt, i }: { src: string; alt: string; i: number }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  if (src && !err) {
    return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} className="w-full h-40 object-contain rounded-2xl mb-3 bg-white" />;
  }
  return (
    <div className="w-full h-40 rounded-2xl mb-3 flex items-center justify-center text-4xl"
      style={{ background: `linear-gradient(135deg, ${COLORS[i % COLORS.length]}, ${COLORS[(i + 2) % COLORS.length]})` }}>🎀</div>
  );
}

function Preview({ src }: { src: string }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  if (!src || err) return null;
  return <img src={src} alt="preview" onError={() => setErr(true)} className="w-full h-32 object-contain rounded-xl mb-3 bg-white" />;
}

type ItemForm = { title: string; note: string; link: string; image_url: string; price: string };
const EMPTY_FORM: ItemForm = { title: "", note: "", link: "", image_url: "", price: "" };

/* A tiny mic recorder: records audio in the browser and hands the Blob to the parent. */
function VoiceRecorder({ blob, onChange }: { blob: Blob | null; onChange: (b: Blob | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const previewUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : ""), [blob]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const start = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported on this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        onChange(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setError("Mic access was blocked. Allow the microphone to record.");
    }
  };
  const stop = () => { recRef.current?.stop(); setRecording(false); };

  return (
    <div className="mb-2">
      {!blob && !recording && (
        <button type="button" onClick={start} className="w-full py-2 rounded-lg font-bold text-xs border-2" style={{ background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--muted)" }}>🎤 Record a voice message (optional)</button>
      )}
      {recording && (
        <button type="button" onClick={stop} className="w-full py-2 rounded-lg font-extrabold text-xs text-white animate-pulse" style={{ background: "#C96F4A" }}>⏹ Stop recording</button>
      )}
      {blob && !recording && (
        <div className="rounded-lg p-2" style={{ background: "var(--input-bg)" }}>
          <audio src={previewUrl} controls className="w-full h-9 mb-1" />
          <button type="button" onClick={() => onChange(null)} className="text-xs font-bold t-muted underline">Re-record / remove</button>
        </div>
      )}
      {error && <p className="text-xs font-bold mt-1" style={{ color: "#C0563B" }}>{error}</p>}
    </div>
  );
}

function Registry({ registryUrl, isAdmin, refreshKey }: { registryUrl?: string; isAdmin: boolean; refreshKey: number }) {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [claims, setClaims] = useState<Record<string, string>>({}); // gift_id -> claimed_by
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [claimer, setClaimer] = useState("");
  const [claimMsg, setClaimMsg] = useState("");
  const [claimVoice, setClaimVoice] = useState<Blob | null>(null);
  const [claimEcard, setClaimEcard] = useState("");           // built-in ecard id ("" = none)
  const [claimCustom, setClaimCustom] = useState<File | null>(null); // guest's own card image
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<null | "new" | string>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  // "My picks" cart: select several gifts, reserve them together, then open on Amazon.
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  const [cartName, setCartName] = useState("");
  const [cartMsg, setCartMsg] = useState("");
  const [cartEcard, setCartEcard] = useState("");
  const [cartCustom, setCartCustom] = useState<File | null>(null);
  const [cartBusy, setCartBusy] = useState(false);
  const [cartDone, setCartDone] = useState<{ reserved: WishlistItem[]; taken: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [its, cls] = await Promise.all([wishlist.list(), gifts.claims()]);
      setItems(its);
      const map: Record<string, string> = {};
      cls.forEach((c) => { map[c.gift_id] = c.claimed_by; });
      setClaims(map);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const togglePick = (id: string) => {
    setPicks((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  // Reserve every picked gift under one name (same card/note on each), then
  // show the store links to order from.
  const checkoutPicks = async () => {
    if (!cartName.trim()) return;
    setCartBusy(true);
    let ecardCustomUrl = "";
    try {
      if (cartCustom) ecardCustomUrl = await uploadEcardImage(cartCustom);
    } catch { /* card upload failed — reserve anyway without it */ }
    const reserved: WishlistItem[] = [];
    const taken: string[] = [];
    for (const id of picks) {
      const g = items.find((x) => x.id === id);
      if (!g) continue;
      try { await gifts.claim(id, cartName.trim(), cartMsg.trim(), "", cartEcard, ecardCustomUrl); reserved.push(g); }
      catch (e: any) { if (e?.status === 409) taken.push(g.title); else taken.push(g.title); }
    }
    await load();
    setPicks(new Set());
    setCartMsg(""); setCartEcard(""); setCartCustom(null);
    setCartDone({ reserved, taken });
    setCartBusy(false);
    if (reserved.length) fireConfetti();
  };

  const claim = async (giftId: string) => {
    if (!claimer.trim()) return;
    setNotice("");
    try {
      let voiceUrl = "";
      if (claimVoice) {
        setNotice("Uploading your voice message…");
        voiceUrl = await uploadAudio(claimVoice);
        setNotice("");
      }
      let ecardCustomUrl = "";
      if (claimCustom) {
        setNotice("Uploading your card…");
        ecardCustomUrl = await uploadEcardImage(claimCustom);
        setNotice("");
      }
      await gifts.claim(giftId, claimer.trim(), claimMsg.trim(), voiceUrl, claimEcard, ecardCustomUrl);
      setOpenId(null); setClaimer(""); setClaimMsg(""); setClaimVoice(null); setClaimEcard(""); setClaimCustom(null); fireConfetti(); await load();
    } catch (e: any) {
      if (e?.status === 409) { setNotice("Someone just grabbed that one! Refreshing…"); await load(); }
      else { setNotice("Couldn't save the card or voice message — try reserving without them."); }
    }
  };
  const unclaim = async (giftId: string) => { try { await gifts.unclaim(giftId); await load(); } catch { /* ignore */ } };

  const openNew = () => { setForm(EMPTY_FORM); setEditing("new"); };
  const openEdit = (g: WishlistItem) => { setForm({ title: g.title, note: g.note, link: g.link, image_url: g.image_url, price: g.price }); setEditing(g.id); };
  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing === "new") await wishlist.create(form);
      else if (editing) await wishlist.update(editing, form);
      setEditing(null); await load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };
  const removeItem = async (g: WishlistItem) => {
    const who = claims[g.id];
    const warning = who
      ? `Delete "${g.title}"?\n\n⚠️ ${who} has reserved this — deleting will also remove their reservation. Consider exporting reservations first.`
      : `Delete "${g.title}" from the wish list? This also clears any reservation on it.`;
    if (!window.confirm(warning)) return;
    try { await wishlist.remove(g.id); await load(); } catch { /* ignore */ }
  };

  // Back up who reserved what — download as CSV.
  const exportReservations = () => {
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const reserved = items.filter((g) => claims[g.id]);
    if (reserved.length === 0) { setNotice("No reservations to export yet."); return; }
    const header = ["gift", "reserved_by", "price", "link"];
    const lines = [header, ...reserved.map((g) => [g.title, claims[g.id], g.price, g.link])];
    const csv = lines.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "reservations.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // Bulk import from CSV/Excel. Recognized columns (case-insensitive): id, title/name, note/description, link/url, image_url/image.
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImporting(true); setNotice("");
    try {
      const XLSX = await import("xlsx"); // loaded on demand — guests never download it
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const raw: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const pick = (row: any, keys: string[]) => {
        for (const k of Object.keys(row)) {
          const norm = k.trim().toLowerCase();
          // match an exact header, or one that starts with the key (e.g. "link (amazon product url)")
          if (keys.some((key) => norm === key || (norm.startsWith(key) && !/[a-z0-9]/.test(norm.charAt(key.length))))) {
            return String(row[k] ?? "").trim();
          }
        }
        return "";
      };
      const rows = raw.map((r) => ({
        id: pick(r, ["id"]) || undefined,
        title: pick(r, ["title", "name", "gift"]),
        note: pick(r, ["note", "notes", "description", "desc"]),
        link: pick(r, ["link", "url", "amazon", "amazon link"]),
        image_url: pick(r, ["image_url", "image", "image url", "img", "photo"]),
        price: pick(r, ["price", "cost"]),
      })).filter((r) => r.title);
      if (rows.length === 0) { setNotice("No rows found — make sure there's a Title column."); return; }
      const { inserted, updated } = await wishlist.bulkUpsert(rows);
      setNotice(`Imported ${inserted} new, updated ${updated}. 🎉`);
      await load();
    } catch { setNotice("Couldn't read that file. Try exporting first and editing that template."); }
    finally { setImporting(false); }
  };

  const exportCsv = () => {
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["id", "title", "note", "link", "image_url", "price"];
    const lines = [header, ...items.map((g) => [g.id, g.title, g.note, g.link, g.image_url, g.price])];
    const csv = lines.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "wishlist.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;

  // Flag likely duplicates (same Amazon ASIN, same store URL, or same title) so the admin can clean them up.
  const dupIds = (() => {
    const asin = (link: string) => (link.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1] || "").toUpperCase();
    const normUrl = (link: string) => {
      const raw = (link || "").trim();
      if (!raw) return "";
      try { const u = new URL(raw); return (u.host.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase(); }
      catch { return raw.toLowerCase(); }
    };
    const groups = new Map<string, string[]>();
    for (const g of items) {
      const key = asin(g.link) || normUrl(g.link) || g.title.trim().toLowerCase().replace(/\s+/g, " ");
      const arr = groups.get(key) || [];
      arr.push(g.id);
      groups.set(key, arr);
    }
    const dups = new Set<string>();
    for (const arr of groups.values()) if (arr.length > 1) arr.forEach((id) => dups.add(id));
    return dups;
  })();
  const dupCount = items.filter((g) => dupIds.has(g.id)).length;

  return (
    <section id="registry" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="🎁" color="#7C9A6D">Housewarming Registry</SectionTitle>
      <p className="text-center font-bold t-muted mb-2 max-w-xl mx-auto">Items from any store — tap one to reserve it so no one buys doubles. Totally optional: your presence is the real present! 💝</p>
      {registryUrl && (
        <div className="text-center mb-4">
          <a href={registryUrl} target="_blank" rel="noreferrer" className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg" style={{ background: /amazon\./i.test(registryUrl) ? "#FF9900" : "#7D97B8" }}>🛒 View the full registry →</a>
        </div>
      )}
      {isAdmin && (
        <div className="text-center mb-4 flex flex-wrap gap-2 justify-center">
          <button onClick={openNew} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg" style={{ background: "#9A6B4F" }}>➕ Add an item</button>
          <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" onChange={onImportFile} className="hidden" />
          <button onClick={() => importRef.current?.click()} disabled={importing} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg disabled:opacity-60" style={{ background: "#7D97B8" }}>{importing ? "Importing…" : "⬆️ Import CSV/Excel"}</button>
          <button onClick={exportCsv} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold shadow-lg" style={{ background: "#7C9A6D", color: "#243318" }}>⬇️ Export CSV</button>
          <button onClick={exportReservations} className="btn-pop inline-block px-6 py-3 rounded-full font-extrabold text-white shadow-lg" style={{ background: "#C0563B" }}>🎁 Export reservations</button>
        </div>
      )}
      {isAdmin && dupCount > 0 && (
        <p className="text-center font-extrabold text-sm mb-4 rounded-full py-2 px-4 max-w-xl mx-auto" style={{ background: "#F1E2CE", color: "#8a3b22" }}>
          ⚠️ {dupCount} possible duplicate{dupCount > 1 ? "s" : ""} (same item or title) — look for the “Duplicate?” tag and delete the extras.
        </p>
      )}
      {notice && <p className="text-center font-bold text-sm mb-4" style={{ color: "#C0563B" }}>{notice}</p>}
      {loading && <p className="t-muted font-bold text-center mb-4">Loading gifts…</p>}
      {!loading && items.length === 0 && <p className="t-muted font-bold text-center mb-4">No registry items yet{isAdmin ? " — add the first one above!" : "."}</p>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((g, i) => {
          const claimedBy = claims[g.id];
          return (
            <div key={g.id} className="surface card-hover rounded-3xl p-5 shadow-lg border-4 flex flex-col" style={{ borderColor: claimedBy ? "var(--input-border)" : COLORS[i % COLORS.length] + "55" }}>
              <Thumb src={g.image_url} alt={g.title} i={i} />
              <h3 className="display font-bold text-lg t-text">{g.title}</h3>
              {isAdmin && dupIds.has(g.id) && (
                <span className="inline-block text-[10px] font-extrabold px-2 py-0.5 rounded-full mt-1 self-start" style={{ background: "#C0563B", color: "#fff" }}>Duplicate?</span>
              )}
              {g.price && <p className="font-extrabold text-base mt-0.5" style={{ color: "#7C9A6D" }}>{g.price}</p>}
              {g.note && <p className="text-sm font-semibold t-muted mt-1 grow">{g.note}</p>}
              {g.link && (
                <a href={g.link} target="_blank" rel="noreferrer"
                  className="btn-pop w-full mt-3 py-2.5 rounded-lg font-extrabold text-sm shadow flex items-center justify-center gap-1"
                  style={/amazon\./i.test(g.link) ? { background: "#FF9900", color: "#1a1a1a" } : { background: "#7D97B8", color: "#fff" }}>
                  {/amazon\./i.test(g.link) ? "🛒 View on Amazon" : "🔗 View item"}
                </a>
              )}
              <div className="mt-3">
                {claimedBy ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-sm px-3 py-2 rounded-full" style={{ background: "var(--input-bg)", color: "var(--muted)" }}>Reserved by {claimedBy} 🎉</span>
                    <button onClick={() => unclaim(g.id)} className="text-xs font-bold t-muted hover:text-red-400 underline">undo</button>
                  </div>
                ) : openId === g.id ? (
                  <div className="pop">
                    <input autoFocus value={claimer} onChange={(e) => setClaimer(e.target.value)} placeholder="Your name" className="w-full mb-2 px-3 py-2 rounded-lg border-2 font-bold text-sm focus:outline-none" style={inputStyle} />
                    <textarea value={claimMsg} onChange={(e) => setClaimMsg(e.target.value)} rows={2} placeholder="Add a note for the family (optional) 💌" className="w-full mb-2 px-3 py-2 rounded-lg border-2 font-semibold text-sm focus:outline-none" style={inputStyle} />
                    <ECardPicker value={claimEcard} custom={claimCustom} onPick={(id) => { setClaimEcard(id); if (id) setClaimCustom(null); }} onCustom={(f) => { setClaimCustom(f); if (f) setClaimEcard(""); }} />
                    {cloudinaryConfigured && <VoiceRecorder blob={claimVoice} onChange={setClaimVoice} />}
                    <div className="flex gap-2">
                      <button onClick={() => claim(g.id)} className="btn-pop flex-1 py-2 rounded-lg font-extrabold text-white text-sm" style={{ background: "#7C9A6D" }}>Reserve</button>
                      <button onClick={() => { setOpenId(null); setClaimer(""); setClaimMsg(""); setClaimVoice(null); setClaimEcard(""); setClaimCustom(null); }} className="btn-pop px-3 py-2 rounded-lg font-bold text-sm t-muted" style={{ background: "var(--input-bg)" }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setOpenId(g.id); setClaimer(""); }} className="btn-pop w-full py-2.5 rounded-lg font-extrabold text-white text-sm shadow" style={{ background: COLORS[i % COLORS.length] }}>I'll bring this 🙌</button>
                )}
                {!claimedBy && openId !== g.id && (
                  <button onClick={() => togglePick(g.id)}
                    className="w-full mt-2 py-1.5 rounded-lg font-bold text-xs border-2 transition-colors"
                    style={picks.has(g.id)
                      ? { background: "#9A6B4F", borderColor: "transparent", color: "#fff" }
                      : { background: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--muted)" }}>
                    {picks.has(g.id) ? "✓ In my picks" : "＋ Add to my picks"}
                  </button>
                )}
              </div>
              {isAdmin && (
                <div className="mt-3 pt-3 border-t flex gap-2" style={{ borderColor: "var(--input-border)" }}>
                  <button onClick={() => openEdit(g)} className="flex-1 text-xs font-bold t-muted underline">Edit</button>
                  <button onClick={() => removeItem(g)} className="flex-1 text-xs font-bold text-red-400 underline">Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs t-muted font-semibold mt-4 text-center">Reservations are visible to everyone who visits this page.</p>

      {/* Floating "my picks" bar */}
      {picks.size > 0 && !cartOpen && !cartDone && (
        <button onClick={() => { setCartOpen(true); setCartName(""); }}
          className="btn-pop fixed bottom-5 left-5 z-[80] px-5 py-3 rounded-full font-extrabold text-white shadow-lg flex items-center gap-2"
          style={{ background: "#9A6B4F" }}>
          🛒 {picks.size} pick{picks.size > 1 ? "s" : ""} — Reserve & open ›
        </button>
      )}

      {/* Checkout: reserve all picks under one name */}
      {cartOpen && !cartDone && (
        <div onClick={() => !cartBusy && setCartOpen(false)} className="fixed inset-0 z-[110] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.8)" }}>
          <div onClick={(e) => e.stopPropagation()} className="surface rounded-3xl p-6 shadow-2xl border-4 w-full max-w-md max-h-[90vh] overflow-auto" style={{ borderColor: "#9A6B4F" }}>
            <h3 className="display font-bold text-xl mb-1" style={{ color: "#9A6B4F" }}>Your picks ({picks.size})</h3>
            <p className="t-muted font-semibold text-sm mb-3">We'll reserve these for you so no one buys doubles, then give you the store links to order.</p>
            <ul className="space-y-1 mb-4 max-h-48 overflow-auto">
              {items.filter((g) => picks.has(g.id)).map((g) => (
                <li key={g.id} className="flex justify-between gap-2 text-sm font-semibold rounded-lg px-3 py-2" style={{ background: "var(--input-bg)" }}>
                  <span className="t-text truncate">{g.title}</span>
                  {g.price && <span className="shrink-0" style={{ color: "#7C9A6D" }}>{g.price}</span>}
                </li>
              ))}
            </ul>
            <label className="block font-extrabold t-muted mb-1 text-sm">Your name</label>
            <input autoFocus value={cartName} onChange={(e) => setCartName(e.target.value)} placeholder="e.g. Aunt Maria" className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
            <label className="block font-extrabold t-muted mb-1 text-sm">Note for the family (optional) 💌</label>
            <textarea value={cartMsg} onChange={(e) => setCartMsg(e.target.value)} rows={2} placeholder="A note the family will see with your gifts" className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
            <label className="block font-extrabold t-muted mb-1 text-sm">Attach a card (optional) 💌</label>
            <ECardPicker value={cartEcard} custom={cartCustom} onPick={(id) => { setCartEcard(id); if (id) setCartCustom(null); }} onCustom={(f) => { setCartCustom(f); if (f) setCartEcard(""); }} />
            <div className="flex gap-2">
              <button onClick={checkoutPicks} disabled={cartBusy || !cartName.trim()} className="btn-pop flex-1 py-3 rounded-xl font-extrabold text-white shadow-md disabled:opacity-60" style={{ background: "#7C9A6D" }}>{cartBusy ? "Reserving…" : "Reserve my picks 🎁"}</button>
              <button onClick={() => setCartOpen(false)} disabled={cartBusy} className="btn-pop px-5 py-3 rounded-xl font-bold t-muted" style={{ background: "var(--input-bg)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Result: reserved, now open on Amazon */}
      {cartDone && (
        <div onClick={() => { setCartDone(null); setCartOpen(false); }} className="fixed inset-0 z-[110] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.8)" }}>
          <div onClick={(e) => e.stopPropagation()} className="surface rounded-3xl p-6 shadow-2xl border-4 w-full max-w-md max-h-[90vh] overflow-auto" style={{ borderColor: "#7C9A6D" }}>
            <h3 className="display font-bold text-xl mb-1" style={{ color: "#7C9A6D" }}>Reserved! 🎉</h3>
            <p className="t-muted font-semibold text-sm mb-3">Tap each to open it at its store and check out there. (They open in new tabs.)</p>
            <div className="space-y-2 mb-3">
              {cartDone.reserved.map((g) => (
                g.link ? (
                  <a key={g.id} href={g.link} target="_blank" rel="noreferrer" className="btn-pop w-full py-2.5 rounded-lg font-extrabold text-sm shadow flex items-center justify-between gap-2 px-3"
                    style={/amazon\./i.test(g.link) ? { background: "#FF9900", color: "#1a1a1a" } : { background: "#7D97B8", color: "#fff" }}>
                    <span className="truncate">{g.title}</span>
                    <span className="shrink-0">{/amazon\./i.test(g.link) ? "🛒 Amazon ›" : "🔗 Open ›"}</span>
                  </a>
                ) : (
                  <div key={g.id} className="w-full py-2.5 rounded-lg font-bold text-sm px-3" style={{ background: "var(--input-bg)", color: "var(--muted)" }}>{g.title} — reserved (no link)</div>
                )
              ))}
            </div>
            {cartDone.taken.length > 0 && (
              <p className="text-sm font-bold mb-3" style={{ color: "#C0563B" }}>
                Already taken by someone else: {cartDone.taken.join(", ")}. (Not reserved for you.)
              </p>
            )}
            <button onClick={() => { setCartDone(null); setCartOpen(false); }} className="btn-pop w-full py-3 rounded-xl font-extrabold text-white shadow-md" style={{ background: "#C96F4A" }}>Done</button>
          </div>
        </div>
      )}

      {editing && (
        <div onClick={() => !saving && setEditing(null)} className="fixed inset-0 z-[100] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.8)" }}>
          <div onClick={(e) => e.stopPropagation()} className="surface rounded-3xl p-6 shadow-2xl border-4 w-full max-w-md max-h-[90vh] overflow-auto" style={{ borderColor: "#9A6B4F" }}>
            <h3 className="display font-bold text-xl mb-4" style={{ color: "#9A6B4F" }}>{editing === "new" ? "Add a gift" : "Edit gift"}</h3>
            <label className="block font-extrabold t-muted mb-1 text-sm">Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Hot Wheels Track Set" className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
            <label className="block font-extrabold t-muted mb-1 text-sm">Note (optional)</label>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Any color is great" className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
            <label className="block font-extrabold t-muted mb-1 text-sm">Price (optional)</label>
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="e.g. $24.99" className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
            <label className="block font-extrabold t-muted mb-1 text-sm">Link (Amazon or any store)</label>
            <input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://www.amazon.com/dp/…" className="w-full mb-3 px-4 py-3 rounded-xl border-2 font-semibold text-sm focus:outline-none" style={inputStyle} />
            <label className="block font-extrabold t-muted mb-1 text-sm">Image URL (optional)</label>
            <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="Right-click product image → Copy image address" className="w-full mb-2 px-4 py-3 rounded-xl border-2 font-semibold text-sm focus:outline-none" style={inputStyle} />
            <Preview src={form.image_url} />
            <div className="flex gap-2 mt-2">
              <button onClick={save} disabled={saving || !form.title.trim()} className="btn-pop flex-1 py-3 rounded-xl font-extrabold text-white shadow-md disabled:opacity-60" style={{ background: "#7C9A6D" }}>{saving ? "Saving…" : "Save"}</button>
              <button onClick={() => setEditing(null)} disabled={saving} className="btn-pop px-5 py-3 rounded-xl font-bold t-muted" style={{ background: "var(--input-bg)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================== HOST PANEL ===================== */
const SECTION_LABELS: [keyof SectionFlags, string][] = [
  ["countdown", "Countdown"], ["details", "Party details"], ["rsvp", "RSVP"],
  ["food", "Bring a dish"], ["photos", "Photo gallery"], ["game", "House predictions"], ["gameCenter", "Game center"], ["gifts", "Registry"],
];

function HostPanel({ sections, onSetSections, themeName, onSetTheme, requireApproval, onSetRequireApproval, guestEnabled, onSetGuestEnabled, familyName, onRefresh, onPreview, onEditDetails, onLock, onViewGuest }:
  { sections: SectionFlags; onSetSections: (p: Partial<SectionFlags>) => void; themeName: ThemeName; onSetTheme: (t: ThemeName) => void; requireApproval: boolean; onSetRequireApproval: (b: boolean) => void; guestEnabled: boolean; onSetGuestEnabled: (b: boolean) => void; familyName: string; onRefresh: () => void; onPreview: () => void; onEditDetails: () => void; onLock: () => void; onViewGuest: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const run = async (label: string, scope: "rsvps" | "potluck" | "gifts" | "wishlist" | "predictions" | "games" | "all") => {
    const msg =
      scope === "all" ? "Clear EVERYTHING (RSVPs, menu, gift reservations, predictions)?"
      : scope === "wishlist" ? "Delete ALL items from the registry (items AND any reservations)?"
      : `Clear ${label}?`;
    if (!window.confirm(`${msg} This can't be undone.`)) return;
    setBusy(label);
    try { await admin.clear(scope); onRefresh(); } catch { /* ignore */ } finally { setBusy(""); }
  };

  // Host-only printable read-aloud sheet: every reserved gift, who it's from, and the note/card.
  const printGiftList = async () => {
    setBusy("print");
    try {
      const list = await gifts.reveal();
      const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
      const blocks = list.length
        ? list.map((g, i) => `<div class="g"><div class="n">${i + 1}. ${esc(g.title)}</div><div class="f">From: ${esc(g.claimed_by)}${g.price ? ` · ${esc(g.price)}` : ""}</div>${g.message ? `<div class="m">“${esc(g.message)}”</div>` : ""}${g.ecard_id || g.ecard_custom_url ? `<div class="v">💌 Card attached — open it in the app</div>` : ""}${g.voice_url ? `<div class="v">🎤 Voice message attached — play it in the app</div>` : ""}</div>`).join("")
        : `<p>No gifts reserved yet.</p>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(familyName)} Housewarming Gifts</title>
        <style>body{font-family:Georgia,serif;max-width:720px;margin:32px auto;padding:0 20px;color:#222}
        h1{color:#d6336c;font-size:28px;margin-bottom:4px}.sub{color:#666;margin-bottom:24px}
        .g{padding:12px 0;border-bottom:1px solid #eee}.n{font-weight:bold;font-size:18px}
        .f{color:#555;font-size:14px;margin-top:2px}.m{margin-top:6px;font-style:italic;color:#333}.v{margin-top:4px;font-size:13px;color:#d6336c;font-weight:bold}
        @media print{.noprint{display:none}}</style></head>
        <body><h1>🏡 ${esc(familyName)} Housewarming Gifts</h1><div class="sub">Reserved gifts, who they're from, and their notes — for reading aloud.</div>
        ${blocks}
        <button class="noprint" onclick="window.print()" style="margin-top:24px;padding:10px 20px;font-size:16px;border:0;border-radius:8px;background:#d6336c;color:#fff;font-weight:bold;cursor:pointer">🖨️ Print</button>
        </body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); w.focus(); }
    } catch { /* ignore */ } finally { setBusy(""); }
  };

  const btn = "btn-pop w-full py-2.5 rounded-xl font-extrabold text-sm shadow text-white disabled:opacity-60";
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} className="btn-pop fixed bottom-5 right-5 z-[80] px-4 py-3 rounded-full font-extrabold text-white shadow-lg" style={{ background: "#9A6B4F" }}>🛠️ Host</button>
      {open && (
        <div className="fixed bottom-20 right-5 z-[80] surface rounded-2xl shadow-2xl border-4 p-4 w-64 max-h-[80vh] overflow-auto pop" style={{ borderColor: "#9A6B4F" }}>
          <p className="display font-bold mb-1" style={{ color: "#9A6B4F" }}>Host controls</p>
          <p className="t-muted text-xs font-semibold mb-3">Only visible to you (admin code).</p>

          <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Site theme</p>
          <div className="grid grid-cols-2 gap-1.5 mb-4">
            {([
              ["warm", "🏡", "Warm home", "linear-gradient(135deg,#C96F4A,#D9A441)"],
              ["pool", "🏖️", "Summer pool", "linear-gradient(135deg,#1D9BB8,#7FD3E6)"],
            ] as [ThemeName, string, string, string][]).map(([t, emoji, label, bg]) => {
              const on = themeName === t;
              return (
                <button key={t} onClick={() => !on && onSetTheme(t)}
                  className="btn-pop rounded-xl px-2 py-2.5 text-xs font-extrabold text-white shadow border-2"
                  style={{ background: bg, borderColor: on ? "#fff" : "transparent", opacity: on ? 1 : 0.65 }}>
                  {emoji} {label}{on ? " ✓" : ""}
                </button>
              );
            })}
          </div>

          <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Privacy & access</p>
          <button onClick={() => onSetRequireApproval(!requireApproval)}
            className="btn-pop w-full flex items-center justify-between px-3 py-2 rounded-xl font-bold text-sm mb-4"
            style={{ background: "var(--input-bg)", color: "var(--text)" }}>
            <span className="text-left leading-tight">🔒 Address needs<br />RSVP approval</span>
            <span className="text-xs font-extrabold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: requireApproval ? "#7C9A6D" : "#cbd5e1" }}>{requireApproval ? "On" : "Off"}</span>
          </button>
          <button onClick={() => onSetGuestEnabled(!guestEnabled)}
            className="btn-pop w-full flex items-center justify-between px-3 py-2 rounded-xl font-bold text-sm mb-4 -mt-2"
            style={{ background: "var(--input-bg)", color: "var(--text)" }}>
            <span className="text-left leading-tight">🎟️ Guest code<br />can unlock the site</span>
            <span className="text-xs font-extrabold px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: guestEnabled ? "#7C9A6D" : "#cbd5e1" }}>{guestEnabled ? "On" : "Off"}</span>
          </button>

          <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Show sections to guests</p>
          <div className="space-y-1.5 mb-4">
            {SECTION_LABELS.map(([key, label]) => {
              const on = sections[key];
              return (
                <button key={key} onClick={() => onSetSections({ [key]: !on })}
                  className="btn-pop w-full flex items-center justify-between px-3 py-2 rounded-xl font-bold text-sm"
                  style={{ background: "var(--input-bg)", color: "var(--text)" }}>
                  <span>{label}</span>
                  <span className="text-xs font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: on ? "#7C9A6D" : "#cbd5e1" }}>{on ? "On" : "Off"}</span>
                </button>
              );
            })}
          </div>

          <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Event</p>
          <button onClick={onEditDetails} className={`${btn} mb-2`} style={{ background: "#7D97B8" }}>✏️ Edit event details</button>
          <button onClick={onPreview} className={`${btn} mb-2`} style={{ background: "#C96F4A" }}>👀 Preview family keepsake</button>
          <button disabled={busy === "print"} onClick={printGiftList} className={`${btn} mb-4`} style={{ background: "#9A6B4F" }}>
            {busy === "print" ? "Preparing…" : "🖨️ Print gifts & cards (read-aloud)"}
          </button>

          <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Danger zone</p>
          <div className="space-y-2">
            <button disabled={!!busy} onClick={() => run("all RSVPs", "rsvps")} className={btn} style={{ background: "#7D97B8" }}>{busy === "all RSVPs" ? "Clearing…" : "Clear RSVPs"}</button>
            <button disabled={!!busy} onClick={() => run("the potluck menu", "potluck")} className={btn} style={{ background: "#D9A441", color: "#5a4310" }}>{busy === "the potluck menu" ? "Clearing…" : "Clear potluck menu"}</button>
            <button disabled={!!busy} onClick={() => run("all gift reservations", "gifts")} className={btn} style={{ background: "#7C9A6D", color: "#243318" }}>{busy === "all gift reservations" ? "Clearing…" : "Clear gift reservations"}</button>
            <button disabled={!!busy} onClick={() => run("the entire registry", "wishlist")} className={btn} style={{ background: "#9A6B4F" }}>{busy === "the entire registry" ? "Clearing…" : "Clear ALL items (registry)"}</button>
            <button disabled={!!busy} onClick={() => run("all game predictions", "predictions")} className={btn} style={{ background: "#C98A8A" }}>{busy === "all game predictions" ? "Clearing…" : "Clear predictions"}</button>
            <button disabled={!!busy} onClick={() => run("the game center", "games")} className={btn} style={{ background: "#1D9BB8" }}>{busy === "the game center" ? "Clearing…" : "Clear game center"}</button>
            <button disabled={!!busy} onClick={() => run("everything", "all")} className={btn} style={{ background: "#C96F4A" }}>{busy === "everything" ? "Clearing…" : "Clear everything"}</button>
          </div>
          <div className="mt-3 pt-3 border-t flex gap-2" style={{ borderColor: "var(--input-border)" }}>
            <button onClick={onViewGuest} className="flex-1 text-xs font-bold t-muted underline">Guest view</button>
            <button onClick={onLock} className="flex-1 text-xs font-bold t-muted underline">Lock site</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ===================== SHARED ===================== */
function SectionTitle({ emoji, color, children }: { emoji: string; color: string; children: React.ReactNode }) {
  return <h2 className="display font-bold text-center mb-6" style={{ fontSize: "clamp(2rem,6vw,3rem)", color }}>{emoji} {children}</h2>;
}
function Footer({ venueName }: { venueName: string }) {
  return (
    <footer className="text-center py-10 px-4">
      <p className="display text-2xl font-bold" style={{ color: "#C96F4A" }}>Can't wait to show you around! 🏡</p>
      <p className="font-bold t-muted mt-1">See you at {venueName}.</p>
    </footer>
  );
}

/* ===================== ECARD PICKER ===================== */
// Compact card chooser used inside the reserve flows: a horizontal strip of the
// built-in housewarming cards, plus an upload button for the guest's own image.
function ECardPicker({ value, custom, onPick, onCustom }:
  { value: string; custom: File | null; onPick: (id: string) => void; onCustom: (f: File | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (custom ? URL.createObjectURL(custom) : ""), [custom]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const picked = ECARDS.find((c) => c.id === value);
  return (
    <div className="mb-2">
      <p className="font-extrabold text-xs t-muted mb-1">Attach a card (optional) 💌</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {ECARDS.map((c) => {
          const on = value === c.id;
          return (
            <button key={c.id} type="button" onClick={() => onPick(on ? "" : c.id)} title={c.label}
              className="btn-pop shrink-0 w-10 h-10 rounded-lg border-2 text-lg flex items-center justify-center"
              style={on ? { background: c.accent, borderColor: "transparent" } : { background: "var(--input-bg)", borderColor: "var(--input-border)" }}>
              {c.emoji}
            </button>
          );
        })}
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; onCustom(f); }} />
        {cloudinaryConfigured && (
          <button type="button" onClick={() => fileRef.current?.click()} title="Use my own image"
            className="btn-pop shrink-0 w-10 h-10 rounded-lg border-2 text-lg flex items-center justify-center"
            style={custom ? { background: "#7D97B8", borderColor: "transparent" } : { background: "var(--input-bg)", borderColor: "var(--input-border)" }}>
            📷
          </button>
        )}
      </div>
      {picked && <p className="text-[11px] font-bold mt-0.5" style={{ color: picked.accent }}>{picked.emoji} {picked.label}{picked.animated ? " (animated)" : ""} — tap again to remove</p>}
      {custom && (
        <div className="flex items-center gap-2 mt-1">
          {preview && <img src={preview} alt="Your card" className="w-10 h-7 object-cover rounded" />}
          <p className="text-[11px] font-bold" style={{ color: "#7D97B8" }}>Your own card image ✓</p>
          <button type="button" onClick={() => onCustom(null)} className="text-[11px] font-bold t-muted underline">remove</button>
        </div>
      )}
    </div>
  );
}

/* ===================== GAME CENTER ===================== */
// The host uploads photos of the games they have on hand (board games, yard
// games, pool toys, …) so guests can browse what's available before and during
// the party. Host-curated: guests only view.
function GameCenter({ isAdmin, refreshKey }: { isAdmin: boolean; refreshKey: number }) {
  const [items, setItems] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState(""); // fallback when Cloudinary isn't configured
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const load = useCallback(async () => {
    try { setItems(await gamesApi.list()); } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const resetForm = () => { setTitle(""); setDescription(""); setFile(null); setImageUrl(""); setAdding(false); };

  const submit = async () => {
    if (!title.trim()) { setNotice("Give the game a name."); return; }
    setBusy(true); setNotice("");
    try {
      let url = imageUrl.trim();
      if (file) url = await uploadImage(file); // Cloudinary upload wins if a file was picked
      await gamesApi.create({ title: title.trim(), imageUrl: url, description: description.trim() });
      resetForm();
      await load();
    } catch (e: any) {
      setNotice(e?.body?.error || "Couldn't add that game — please try again.");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this game from the Game Center?")) return;
    try { await gamesApi.remove(id); await load(); } catch { /* ignore */ }
  };

  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;
  const inputCls = "w-full mb-2 px-4 py-2.5 rounded-xl border-2 font-semibold text-sm focus:outline-none";

  return (
    <section id="game-center" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="🎲" color="#1D9BB8">Game Center</SectionTitle>
      <p className="text-center font-bold t-muted -mt-4 mb-6">Here's what we've got on hand — come ready to play!</p>

      {isAdmin && (
        <div className="surface rounded-2xl border-2 p-4 mb-6 max-w-lg mx-auto" style={{ borderColor: "var(--input-border)" }}>
          {!adding ? (
            <button onClick={() => setAdding(true)} className="btn-pop w-full py-2.5 rounded-xl font-extrabold text-white shadow" style={{ background: "#1D9BB8" }}>
              ➕ Add a game (photo + name)
            </button>
          ) : (
            <>
              <p className="font-extrabold t-muted text-xs uppercase tracking-wide mb-2">Add a game</p>
              <input value={title} onChange={(e) => { setTitle(e.target.value); setNotice(""); }} placeholder="Game name (e.g. Catan, Cornhole)" className={inputCls} style={inputStyle} />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional note (players, where it lives, …)" className={inputCls} style={inputStyle} />
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; setFile(f); }} />
              {cloudinaryConfigured ? (
                <div className="flex items-center gap-2 mb-2">
                  <button type="button" onClick={() => fileRef.current?.click()} className="btn-pop px-3 py-2 rounded-xl font-bold text-sm" style={inputStyle}>
                    📷 {file ? "Change photo" : "Add a photo"}
                  </button>
                  {preview && <img src={preview} alt="Game" className="w-12 h-12 object-cover rounded-lg" />}
                  {file && <button type="button" onClick={() => setFile(null)} className="text-xs font-bold t-muted underline">remove</button>}
                </div>
              ) : (
                <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Photo URL (optional, https://…)" className={inputCls} style={inputStyle} />
              )}
              {notice && <p className="text-red-500 font-bold mb-2 text-sm">{notice}</p>}
              <div className="flex gap-2">
                <button onClick={submit} disabled={busy} className="btn-pop flex-1 py-2.5 rounded-xl font-extrabold text-white shadow disabled:opacity-60" style={{ background: "#1D9BB8" }}>
                  {busy ? "Adding…" : "Add game"}
                </button>
                <button onClick={resetForm} disabled={busy} className="btn-pop px-4 py-2.5 rounded-xl font-bold t-muted" style={{ background: "var(--input-bg)" }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-center font-bold t-muted">Loading the games… 🎲</p>
      ) : items.length === 0 ? (
        <p className="text-center font-bold t-muted">{isAdmin ? "No games yet — add the first one above!" : "The hosts are still stocking the game shelf — check back soon!"}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {items.map((g) => (
            <div key={g.id} className="surface rounded-2xl border-2 overflow-hidden shadow-sm relative" style={{ borderColor: "var(--input-border)" }}>
              {g.image_url ? (
                <img src={thumbUrl(g.image_url)} alt={g.title} loading="lazy" className="w-full aspect-square object-cover" />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center text-5xl" style={{ background: "var(--input-bg)" }}>🎲</div>
              )}
              <div className="p-3">
                <p className="font-extrabold text-sm leading-snug">{g.title}</p>
                {g.description && <p className="t-muted text-xs font-semibold mt-0.5">{g.description}</p>}
              </div>
              {isAdmin && (
                <button onClick={() => remove(g.id)} title="Remove"
                  className="btn-pop absolute top-2 right-2 w-7 h-7 rounded-full text-white text-xs font-extrabold shadow" style={{ background: "#EF7674" }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ===================== HOUSE PREDICTIONS GAME ===================== */
// Guests write down their predictions about the new house. Everyone sees how
// many people have played; the host and the family see the actual answers
// (revealed as a party moment, not a live spoiler feed).
const PREDICTION_QUESTIONS: { id: string; label: string; placeholder: string }[] = [
  { id: "first-room",   label: "Which room gets fully decorated first?", placeholder: "e.g. the living room" },
  { id: "first-break",  label: "What's the first thing to break?", placeholder: "e.g. the garbage disposal" },
  { id: "plants",       label: "How many houseplants will they own by next year?", placeholder: "e.g. 12 (three still alive)" },
  { id: "diy",          label: "What's the first big DIY project?", placeholder: "e.g. painting the kitchen" },
  { id: "visitor",      label: "Who's going to visit the most?", placeholder: "e.g. Grandma, obviously" },
];

function Predictions({ role, refreshKey }: { role: Role; refreshKey: number }) {
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);
  const [entries, setEntries] = useState<Prediction[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const canSeeAnswers = role === "admin" || role === "family";

  const load = useCallback(async () => {
    try {
      const data = await predictions.list();
      setCount(data.count);
      setEntries(data.entries);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const submit = async () => {
    setError("");
    if (!name.trim()) { setError("Add your name so we know whose predictions these are 🙂"); return; }
    if (!Object.values(answers).some((v) => v.trim())) { setError("Answer at least one question!"); return; }
    setSubmitting(true);
    try {
      await predictions.submit(name.trim(), answers);
      setName(""); setAnswers({}); setDone(true); fireConfetti();
      await load();
    } catch { setError("Couldn't save your predictions — please try again."); }
    finally { setSubmitting(false); }
  };

  const removeEntry = async (p: Prediction) => {
    if (!window.confirm(`Delete the predictions from "${p.name}"?`)) return;
    try { await predictions.remove(p.id); await load(); } catch { /* ignore */ }
  };

  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;
  const qLabel = (id: string) => PREDICTION_QUESTIONS.find((q) => q.id === id)?.label || id;

  return (
    <section id="game" className="max-w-4xl mx-auto px-4 py-10">
      <SectionTitle emoji="🔮" color="#C98A8A">House Predictions</SectionTitle>
      <p className="text-center font-bold t-muted mb-6 max-w-xl mx-auto">
        Make your predictions about life in the new house — the family reads them all out at the party (and again in a year, to see who was right). 🏆
      </p>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="surface rounded-3xl p-6 shadow-lg border-4 h-fit" style={{ borderColor: "#F1E2CE" }}>
          {done ? (
            <div className="text-center py-6 pop">
              <div className="text-4xl mb-2">🔮✨</div>
              <p className="display font-bold text-xl t-text">Predictions locked in!</p>
              <p className="t-muted font-semibold text-sm mt-1">The family will read them at the party.</p>
              <button onClick={() => setDone(false)} className="mt-4 text-xs font-bold t-muted underline">Add another set</button>
            </div>
          ) : (
            <>
              <label className="block font-extrabold t-muted mb-1">Your name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Uncle Rob" className="w-full mb-4 px-4 py-3 rounded-xl border-2 font-semibold focus:outline-none" style={inputStyle} />
              {PREDICTION_QUESTIONS.map((q) => (
                <div key={q.id} className="mb-3">
                  <label className="block font-extrabold t-muted mb-1 text-sm">{q.label}</label>
                  <input value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder={q.placeholder}
                    className="w-full px-4 py-2.5 rounded-xl border-2 font-semibold text-sm focus:outline-none" style={inputStyle} />
                </div>
              ))}
              {error && <p className="text-red-500 font-bold mb-3 text-sm">{error}</p>}
              <button onClick={submit} disabled={submitting} className="btn-pop w-full py-3.5 rounded-xl font-extrabold text-white text-lg shadow-md disabled:opacity-60" style={{ background: "#C98A8A" }}>
                {submitting ? "Saving…" : "Lock in my predictions 🔮"}
              </button>
            </>
          )}
        </div>
        <div className="surface rounded-3xl p-6 shadow-lg border-4" style={{ borderColor: "#E7EAD9" }}>
          <div className="rounded-2xl p-4 mb-4 text-center text-white" style={{ background: "#C98A8A" }}>
            <div className="display text-4xl font-bold">{count}</div>
            <div className="font-bold opacity-90">prediction{count === 1 ? "" : "s"} so far</div>
          </div>
          {!canSeeAnswers ? (
            <p className="t-muted font-bold text-center py-6">🤫 Answers are a surprise — the family reveals them at the party!</p>
          ) : entries === null ? (
            <p className="t-muted font-bold text-center py-6">Loading predictions…</p>
          ) : entries.length === 0 ? (
            <p className="t-muted font-bold text-center py-6">No predictions yet — share the game with your guests! 🔮</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-auto pr-1">
              {entries.map((p) => (
                <li key={p.id} className="rounded-xl px-3 py-2" style={{ background: "var(--input-bg)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold t-text">{p.name}</span>
                    {role === "admin" && <button onClick={() => removeEntry(p)} className="text-xs font-bold text-red-400 underline shrink-0">Delete</button>}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(p.answers).map(([qid, ans]) => (
                      <li key={qid} className="text-sm">
                        <span className="font-bold t-muted">{qLabel(qid)}</span>{" "}
                        <span className="font-semibold t-text italic">“{ans}”</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {canSeeAnswers && <p className="text-xs t-muted font-semibold mt-3 text-center">Only you {role === "admin" ? "(host)" : "(family)"} can see the answers — guests just see the count.</p>}
        </div>
      </div>
    </section>
  );
}

/* ===================== EDIT EVENT DETAILS (host) ===================== */
// Live edits to the event content (name, date, venue, note, …) — saved to the
// server so nothing needs an env change or redeploy.
function EditDetailsModal({ event, onClose, onSaved }: { event: EventDetails; onClose: () => void; onSaved: (next: EventContent) => void }) {
  const [form, setForm] = useState<EventContent>({
    themeName: event.themeName, // not edited here — the Host panel's theme picker owns this; it just rides along
    requireRsvpApproval: event.requireRsvpApproval, // same: owned by the Host panel privacy toggle
    guestCodeEnabled: event.guestCodeEnabled, // same: owned by the Host panel access toggle
    familyName: event.familyName, tagline: event.tagline, partyDate: event.partyDate,
    timeLabel: event.timeLabel, venueName: event.venueName, address: event.address,
    hostNote: event.hostNote, rsvpDeadline: event.rsvpDeadline,
    dishCategories: event.dishCategories, registryUrl: event.registryUrl || "",
  });
  const [dishText, setDishText] = useState(event.dishCategories.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!form.familyName.trim()) { setError("Family name is required."); return; }
    if (!form.partyDate.trim()) { setError("Party date is required."); return; }
    const dishCategories = dishText.split(",").map((s) => s.trim()).filter(Boolean);
    if (dishCategories.length === 0) { setError("Add at least one dish category."); return; }
    setSaving(true);
    try {
      const next = await admin.setContent({ ...form, familyName: form.familyName.trim(), dishCategories });
      onSaved(next);
    } catch { setError("Couldn't save — please try again."); }
    finally { setSaving(false); }
  };

  const inputStyle = { background: "var(--input-bg)", borderColor: "var(--input-border)" } as const;
  const inputCls = "w-full mb-3 px-4 py-2.5 rounded-xl border-2 font-semibold text-sm focus:outline-none";
  const label = (t: string) => <label className="block font-extrabold t-muted mb-1 text-sm">{t}</label>;

  return (
    <div onClick={() => !saving && onClose()} className="fixed inset-0 z-[150] flex items-center justify-center p-4 pop" style={{ background: "rgba(0,0,0,.8)" }}>
      <div onClick={(e) => e.stopPropagation()} className="surface rounded-3xl p-6 shadow-2xl border-4 w-full max-w-lg max-h-[90vh] overflow-auto" style={{ borderColor: "#7D97B8" }}>
        <h3 className="display font-bold text-xl mb-1" style={{ color: "#7D97B8" }}>Edit event details</h3>
        <p className="t-muted font-semibold text-sm mb-4">Changes go live for everyone right away — no redeploy needed.</p>
        {label("Family name")}
        <input value={form.familyName} onChange={(e) => setForm({ ...form, familyName: e.target.value })} placeholder="e.g. The Fontanez Family" className={inputCls} style={inputStyle} />
        {label("Tagline (finishes “Come celebrate the new place with …”)")}
        <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. good food and a grand tour" className={inputCls} style={inputStyle} />
        <div className="grid sm:grid-cols-2 gap-0 sm:gap-3">
          <div>
            {label("Party date & time")}
            <input type="datetime-local" value={form.partyDate} onChange={(e) => setForm({ ...form, partyDate: e.target.value })} className={inputCls} style={inputStyle} />
          </div>
          <div>
            {label("Time label (as shown to guests)")}
            <input value={form.timeLabel} onChange={(e) => setForm({ ...form, timeLabel: e.target.value })} placeholder="e.g. 3:00 – 8:00 PM" className={inputCls} style={inputStyle} />
          </div>
        </div>
        {label("Venue name")}
        <input value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} className={inputCls} style={inputStyle} />
        {label("Address")}
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} style={inputStyle} />
        {label("Host note")}
        <textarea value={form.hostNote} onChange={(e) => setForm({ ...form, hostNote: e.target.value })} rows={3} className={inputCls} style={inputStyle} />
        <div className="grid sm:grid-cols-2 gap-0 sm:gap-3">
          <div>
            {label("RSVP deadline (text)")}
            <input value={form.rsvpDeadline} onChange={(e) => setForm({ ...form, rsvpDeadline: e.target.value })} placeholder="e.g. August 8" className={inputCls} style={inputStyle} />
          </div>
          <div>
            {label("Registry link (optional, any store)")}
            <input value={form.registryUrl} onChange={(e) => setForm({ ...form, registryUrl: e.target.value })} placeholder="https://…" className={inputCls} style={inputStyle} />
          </div>
        </div>
        {label("Dish categories (comma-separated)")}
        <input value={dishText} onChange={(e) => setDishText(e.target.value)} placeholder="Appetizers, Mains, Sides, Desserts, Drinks" className={inputCls} style={inputStyle} />
        {error && <p className="text-red-500 font-bold mb-3 text-sm">{error}</p>}
        <div className="flex gap-2 mt-2">
          <button onClick={save} disabled={saving} className="btn-pop flex-1 py-3 rounded-xl font-extrabold text-white shadow-md disabled:opacity-60" style={{ background: "#7C9A6D" }}>{saving ? "Saving…" : "Save changes"}</button>
          <button onClick={onClose} disabled={saving} className="btn-pop px-5 py-3 rounded-xl font-bold t-muted" style={{ background: "var(--input-bg)" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function fireConfetti() {
  for (let i = 0; i < 40; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.left = Math.random() * 100 + "vw";
    el.style.background = COLORS[i % COLORS.length];
    el.style.animation = `fall ${1.5 + Math.random() * 1.5}s linear forwards`;
    el.style.animationDelay = Math.random() * 0.3 + "s";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}
