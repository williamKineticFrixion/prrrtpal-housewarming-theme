import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { pool } from "../db";
import { requireAuth } from "../auth";

export const wishlistRouter = Router();

const COLS = "id, title, note, link, image_url, price, sort_order";

// Any signed-in guest or admin can view the list.
wishlistRouter.get("/", requireAuth(), async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${COLS} FROM wishlist_items ORDER BY sort_order ASC, created_at ASC`);
  res.json(rows);
});

// Everything below requires the admin token.
wishlistRouter.use(requireAuth(["admin"]));

const createSchema = z.object({
  title: z.string().min(1).max(160),
  note: z.string().max(300).optional().default(""),
  link: z.string().max(2000).optional().default(""),
  image_url: z.string().max(2000).optional().default(""),
  price: z.string().max(40).optional().default(""),
});

wishlistRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid item" });
  const { title, note, link, image_url, price } = parsed.data;
  const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM wishlist_items");
  const { rows } = await pool.query(
    `INSERT INTO wishlist_items (id, title, note, link, image_url, price, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
    [randomUUID(), title.trim(), note.trim(), link.trim(), image_url.trim(), price.trim(), maxRows[0].next]
  );
  res.status(201).json(rows[0]);
});

// Bulk add/update from a CSV or Excel import. Rows with a matching id are updated;
// rows without an id (or a new id) are inserted. Title is required per row.
const bulkSchema = z.object({
  items: z.array(z.object({
    id: z.string().max(64).optional(),
    title: z.string().min(1).max(160),
    note: z.string().max(300).optional().default(""),
    link: z.string().max(2000).optional().default(""),
    image_url: z.string().max(2000).optional().default(""),
    price: z.string().max(40).optional().default(""),
  })).max(500),
});

wishlistRouter.post("/bulk", async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid import" });
  const { items } = parsed.data;

  // Build lookup of existing items so an import updates matches instead of duplicating them.
  // Match order: Amazon ASIN, then normalized URL (works for ANY store), then title.
  const asin = (link: string) => (link.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1] || "").toUpperCase();
  const normUrl = (link: string) => {
    const raw = (link || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      return (u.host.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
    } catch { return raw.toLowerCase(); }
  };
  const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const { rows: existing } = await pool.query("SELECT id, title, link FROM wishlist_items");
  const byAsin = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const e of existing) {
    const a = asin(e.link || "");
    if (a) byAsin.set(a, e.id);
    const u = normUrl(e.link || "");
    if (u) byUrl.set(u, e.id);
    byTitle.set(normTitle(e.title || ""), e.id);
  }

  const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM wishlist_items");
  let nextOrder = (maxRows[0].m as number) + 1;
  let inserted = 0, updated = 0;
  for (const it of items) {
    const a = asin(it.link || "");
    const u = normUrl(it.link || "");
    const t = normTitle(it.title);
    // Resolve a target id: explicit id wins, else ASIN, else normalized URL (any store), else title, else new.
    const id = (it.id && it.id.trim()) || (a && byAsin.get(a)) || (u && byUrl.get(u)) || byTitle.get(t) || randomUUID();
    const r = await pool.query(
      `INSERT INTO wishlist_items (id, title, note, link, image_url, price, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, note = EXCLUDED.note, link = EXCLUDED.link, image_url = EXCLUDED.image_url, price = EXCLUDED.price
       RETURNING (xmax = 0) AS inserted`,
      [id, it.title.trim(), (it.note || "").trim(), (it.link || "").trim(), (it.image_url || "").trim(), (it.price || "").trim(), nextOrder]
    );
    // Remember what we just wrote so duplicate rows within the same file also collapse.
    if (a) byAsin.set(a, id);
    if (u) byUrl.set(u, id);
    byTitle.set(t, id);
    if (r.rows[0]?.inserted) { inserted++; nextOrder++; } else { updated++; }
  }
  res.json({ inserted, updated, total: items.length });
});

// Partial update — only the fields you send get changed (no defaults, so omitted fields are left alone).
const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  note: z.string().max(300).optional(),
  link: z.string().max(2000).optional(),
  image_url: z.string().max(2000).optional(),
  price: z.string().max(40).optional(),
});

wishlistRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const fields = parsed.data;
  const keys = Object.keys(fields) as (keyof typeof fields)[]; // fixed allow-list from the schema, safe to interpolate
  if (keys.length === 0) return res.status(400).json({ error: "Nothing to update" });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = keys.map((k) => (fields[k] as string).trim());
  const { rows } = await pool.query(`UPDATE wishlist_items SET ${sets} WHERE id = $1 RETURNING ${COLS}`, [req.params.id, ...values]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

wishlistRouter.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM gift_claims WHERE gift_id = $1", [req.params.id]); // drop any reservation too
  await pool.query("DELETE FROM wishlist_items WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
