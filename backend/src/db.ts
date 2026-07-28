import { Pool } from "pg";
import { PRIVATE_EVENT, DEFAULT_CONTENT, type EventContent } from "./config";

export type { EventContent };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("⚠️  DATABASE_URL is not set — the API will fail on DB calls.");
}

// Neon requires SSL. Locally (localhost) we skip it.
const isLocal = !!connectionString && connectionString.includes("localhost");

export const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : undefined,
  max: 5, // keep small; Render free + Neon free are modest
});

// Idempotent — safe to run on every boot. gen_random_uuid() is built into PG13+ (Neon is 15/16).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS rsvps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  attending   boolean NOT NULL DEFAULT true,
  party_size  int NOT NULL DEFAULT 1,
  message     text,
  approved    boolean NOT NULL DEFAULT false, -- host approval unlocks the address for this guest
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS potluck_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL,
  name        text NOT NULL,
  dish        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- gift_id is the PRIMARY KEY: the database itself guarantees one claim per gift.
CREATE TABLE IF NOT EXISTS gift_claims (
  gift_id     text PRIMARY KEY,
  claimed_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  note        text NOT NULL DEFAULT '',
  link        text NOT NULL DEFAULT '',
  image_url   text NOT NULL DEFAULT '',
  price       text NOT NULL DEFAULT '',
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gallery_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url         text NOT NULL,
  caption     text NOT NULL DEFAULT '',
  uploaded_by text NOT NULL DEFAULT '',
  approved    boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gallery_photos_url_idx ON gallery_photos(url);

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- House Predictions game: each guest submits one set of answers (answers is a
-- jsonb map of question-id -> answer text). Guests see only the count; the
-- host and family see everything.
CREATE TABLE IF NOT EXISTS predictions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  answers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Game Center: the host uploads photos of the games they have (board games,
-- yard games, pool toys, …) so guests can see what's available. Host-curated,
-- like the wishlist — guests only read.
CREATE TABLE IF NOT EXISTS game_center_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  image_url   text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Migrations for databases created before these columns existed (safe no-ops otherwise):
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'yes';
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS email  text NOT NULL DEFAULT '';
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS phone  text NOT NULL DEFAULT '';
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS edit_token text;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS pin_hash   text;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS price text NOT NULL DEFAULT '';
ALTER TABLE gift_claims ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '';
ALTER TABLE gift_claims ADD COLUMN IF NOT EXISTS voice_url text NOT NULL DEFAULT '';
`;

export async function initDb(): Promise<void> {
  await pool.query(SCHEMA);
  console.log("✅ Database schema ready");
}

// On first boot only, populate the wishlist from the config seed.
// After that the admin edits it from the app, so we never overwrite live data.
export async function seedWishlist(): Promise<void> {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM wishlist_items");
  if (rows[0].n > 0) return;
  let i = 0;
  for (const it of PRIVATE_EVENT.wishlist) {
    await pool.query(
      `INSERT INTO wishlist_items (id, title, note, link, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [it.id, it.title, it.note, it.link, "", i++]
    );
  }
  console.log("✅ Wishlist seeded from config");
}

// Which sections are visible to guests. Admin toggles these from the Host panel.
export type Sections = { countdown: boolean; details: boolean; rsvp: boolean; food: boolean; photos: boolean; gifts: boolean; game: boolean; gameCenter: boolean };
export const DEFAULT_SECTIONS: Sections = { countdown: true, details: true, rsvp: true, food: true, photos: true, gifts: true, game: true, gameCenter: true };

export async function getSections(): Promise<Sections> {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'sections'");
    if (rows[0]?.value) return { ...DEFAULT_SECTIONS, ...(rows[0].value as Partial<Sections>) };
  } catch { /* table may not exist yet */ }
  return { ...DEFAULT_SECTIONS };
}

export async function setSections(partial: Partial<Sections>): Promise<Sections> {
  const next = { ...(await getSections()), ...partial };
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('sections', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
    [JSON.stringify(next)]
  );
  return next;
}

// Host-editable event content (name, date, venue, host note, …). Same storage
// pattern as sections: a single 'content' row in the settings table, layered
// over the DEFAULT_CONTENT seed so a missing/partial row never breaks the page.
export async function getContent(): Promise<EventContent> {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'content'");
    if (rows[0]?.value) return { ...DEFAULT_CONTENT, ...(rows[0].value as Partial<EventContent>) };
  } catch { /* table may not exist yet */ }
  return { ...DEFAULT_CONTENT };
}

export async function setContent(partial: Partial<EventContent>): Promise<EventContent> {
  const next = { ...(await getContent()), ...partial };
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('content', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
    [JSON.stringify(next)]
  );
  return next;
}
