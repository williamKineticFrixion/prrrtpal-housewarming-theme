// Event details. Sensitive fields (address) are ONLY returned by the protected
// /api/event route — they never reach an unauthenticated visitor.
// Set these as environment variables on Render; the fallbacks are just samples.

export const PUBLIC_EVENT = {
  familyName: process.env.EVENT_FAMILY_NAME || "The Fontanez Family",
  defaultTheme: (process.env.EVENT_DEFAULT_THEME as "day" | "night") || "day",
};

export const PRIVATE_EVENT = {
  ...PUBLIC_EVENT,
  tagline: process.env.EVENT_TAGLINE || "good food, good friends, and a grand tour of the new place",
  partyDate: process.env.EVENT_DATE || "2026-08-15T15:00:00",
  timeLabel: process.env.EVENT_TIME_LABEL || "3:00 – 8:00 PM",
  venueName: process.env.EVENT_VENUE || "The New Fontanez Home",
  address: process.env.EVENT_ADDRESS || "123 Maple Lane, Roebling, NJ",
  hostNote:
    process.env.EVENT_HOST_NOTE ||
    "Come see the new place! We'll have food, drinks, and the full house tour. Kids welcome. RSVP below so we know how many chairs to borrow. 🏡",
  rsvpDeadline: process.env.EVENT_RSVP_DEADLINE || "August 8",
  registryUrl: process.env.EVENT_REGISTRY_URL || "", // optional link to a full registry (any store)
  dishCategories: (process.env.EVENT_DISH_CATEGORIES || "Appetizers,Mains,Sides,Desserts,Drinks")
    .split(",")
    .map((s) => s.trim()),
  // First-boot registry seed — replace/import your real items from the Host panel.
  // Links can point at ANY store (Amazon, Target, Wayfair, Home Depot, …).
  wishlist: [
    { id: "h1", title: "Cast Iron Dutch Oven", note: "For big family dinners 🍲", link: "" },
    { id: "h2", title: "Cozy Throw Blanket", note: "Living room couch", link: "" },
    { id: "h3", title: "Herb Garden Starter Kit", note: "Kitchen windowsill", link: "" },
    { id: "h4", title: "Tool Set", note: "Every new home needs one 🔧", link: "" },
    { id: "h5", title: "Picture Frames (set)", note: "For the hallway gallery wall", link: "" },
    { id: "h6", title: "Doormat", note: "Something with personality", link: "" },
  ],
};

// ---------------------------------------------------------------------------
// Host-editable content.
// These are the fields the host can change live from the Host panel. The values
// in the .env (above) are only DEFAULTS — used to seed the very first load.
// Once saved, the live values come from the `settings` table (key = 'content'),
// so changing them no longer needs an edit + redeploy.
// NOTE: defaultTheme is intentionally NOT here — it's a deploy default, and the
// host already flips day/night live with the theme switch.
// ---------------------------------------------------------------------------
// Site-wide visual theme. "warm" = the terracotta/sage housewarming palette;
// "pool" = summer pool party (aqua, sunny yellow, coral). Picked live from the
// Host panel; stored with the rest of the host-editable content.
export type ThemeName = "warm" | "pool";
const themeNameFromEnv = (): ThemeName =>
  process.env.EVENT_THEME_NAME === "pool" ? "pool" : "warm";

export type EventContent = {
  themeName: ThemeName;
  // When true, guests must RSVP AND be approved by the host before the party
  // address + directions are shown to them. Admin + family always see them.
  requireRsvpApproval: boolean;
  familyName: string;
  tagline: string;
  partyDate: string;   // ISO-local, e.g. "2026-08-15T15:00:00" — drives countdown + photo gate
  timeLabel: string;
  venueName: string;
  address: string;
  hostNote: string;
  rsvpDeadline: string;
  dishCategories: string[];
  registryUrl: string;
};

export const DEFAULT_CONTENT: EventContent = {
  themeName: themeNameFromEnv(),
  requireRsvpApproval: process.env.EVENT_REQUIRE_RSVP_APPROVAL !== "false", // on unless explicitly disabled

  familyName: PRIVATE_EVENT.familyName,
  tagline: PRIVATE_EVENT.tagline,
  partyDate: PRIVATE_EVENT.partyDate,
  timeLabel: PRIVATE_EVENT.timeLabel,
  venueName: PRIVATE_EVENT.venueName,
  address: PRIVATE_EVENT.address,
  hostNote: PRIVATE_EVENT.hostNote,
  rsvpDeadline: PRIVATE_EVENT.rsvpDeadline,
  dishCategories: PRIVATE_EVENT.dishCategories,
  registryUrl: PRIVATE_EVENT.registryUrl,
};
