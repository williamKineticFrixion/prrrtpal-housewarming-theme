import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../auth";

export const giftRouter = Router();
giftRouter.use(requireAuth());

// Public-to-guests claim list: only who reserved what (NO messages — those are private).
giftRouter.get("/claims", async (_req, res) => {
  const { rows } = await pool.query("SELECT gift_id, claimed_by, created_at FROM gift_claims");
  res.json(rows);
});

// Auto-migrate: add ecard columns if they don't exist yet.
pool.query(`
  ALTER TABLE gift_claims
    ADD COLUMN IF NOT EXISTS ecard_id         TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ecard_custom_url TEXT    NOT NULL DEFAULT ''
`).catch(() => {/* already exists or unsupported — safe to ignore */});

// The family keepsake view + host print sheet: reserved gifts with image, who
// they're from, and the note/card. Restricted to the host and the family-code
// holder — regular guests can't see messages. No date gate: a housewarming
// keepsake is meant to be readable anytime.
giftRouter.get("/reveal", requireAuth(["admin", "family"]), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.gift_id, c.claimed_by, c.message, c.voice_url,
            c.ecard_id, c.ecard_custom_url, c.created_at,
            w.title, w.image_url, w.link, w.price
     FROM gift_claims c
     JOIN wishlist_items w ON w.id = c.gift_id
     ORDER BY c.created_at`
  );
  res.json(rows);
});

const claimSchema = z.object({
  giftId: z.string().min(1).max(60),
  claimedBy: z.string().min(1).max(120),
  message: z.string().max(600).optional().default(""),
  voiceUrl: z.string().max(500).optional().default(""),
  ecardId: z.string().max(60).optional().default(""),
  ecardCustomUrl: z.string().max(500).optional().default(""),
});

// The PRIMARY KEY on gift_id means concurrent claims can't both win.
// ON CONFLICT DO NOTHING -> rowCount 0 means someone already claimed it.
giftRouter.post("/claims", async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid claim" });
  const { giftId, claimedBy, message, voiceUrl, ecardId, ecardCustomUrl } = parsed.data;
  const result = await pool.query(
    `INSERT INTO gift_claims (gift_id, claimed_by, message, voice_url, ecard_id, ecard_custom_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (gift_id) DO NOTHING
     RETURNING gift_id, claimed_by, created_at`,
    [giftId, claimedBy.trim(), message.trim(), voiceUrl.trim(), ecardId.trim(), ecardCustomUrl.trim()]
  );
  if (result.rowCount === 0) {
    const existing = await pool.query("SELECT claimed_by FROM gift_claims WHERE gift_id = $1", [giftId]);
    return res.status(409).json({ error: "Already reserved", claimedBy: existing.rows[0]?.claimed_by });
  }
  res.status(201).json(result.rows[0]);
});

giftRouter.delete("/claims/:giftId", async (req, res) => {
  await pool.query("DELETE FROM gift_claims WHERE gift_id = $1", [req.params.giftId]);
  res.json({ ok: true });
});
