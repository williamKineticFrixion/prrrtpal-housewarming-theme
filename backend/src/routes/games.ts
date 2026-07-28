import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../auth";

export const gamesRouter = Router();
gamesRouter.use(requireAuth());

const COLS = "id, title, image_url, description, created_at";

// Game Center: photos of the games the family has on hand so guests can see
// what's available. Host-curated (like the wishlist) — guests only read.
gamesRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${COLS} FROM game_center_items ORDER BY created_at ASC`);
  res.json(rows);
});

// Image is optional (a title-only card still tells guests the game exists).
// Any https URL is accepted — this route is admin-only, and the Host panel's
// upload button produces a Cloudinary URL anyway; the plain-URL path is the
// fallback for when Cloudinary isn't configured.
const httpsUrl = z
  .string()
  .max(2000)
  .refine((s) => s === "" || /^https:\/\//i.test(s), { message: "Image must be an https URL" });

const addSchema = z.object({
  title: z.string().min(1).max(120),
  imageUrl: httpsUrl.optional().default(""),
  description: z.string().max(300).optional().default(""),
});

gamesRouter.post("/", requireAuth(["admin"]), async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid game" });
  const { title, imageUrl, description } = parsed.data;
  const { rows } = await pool.query(
    `INSERT INTO game_center_items (title, image_url, description)
     VALUES ($1, $2, $3) RETURNING ${COLS}`,
    [title.trim(), imageUrl.trim(), description.trim()]
  );
  res.status(201).json(rows[0]);
});

// Fix a typo or swap a photo without deleting and re-adding.
const patchSchema = z
  .object({
    title: z.string().min(1).max(120),
    imageUrl: httpsUrl,
    description: z.string().max(300),
  })
  .partial()
  .strict();

gamesRouter.patch("/:id", requireAuth(["admin"]), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid game" });
  const p = parsed.data;
  const { rows } = await pool.query(
    `UPDATE game_center_items SET
       title       = COALESCE($2, title),
       image_url   = COALESCE($3, image_url),
       description = COALESCE($4, description)
     WHERE id = $1 RETURNING ${COLS}`,
    [req.params.id, p.title?.trim() ?? null, p.imageUrl?.trim() ?? null, p.description?.trim() ?? null]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

gamesRouter.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  await pool.query("DELETE FROM game_center_items WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
