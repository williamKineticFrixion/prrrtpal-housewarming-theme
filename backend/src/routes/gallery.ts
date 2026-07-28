import { Router } from "express";
import { z } from "zod";
import { v2 as cloudinary } from "cloudinary";
import { pool } from "../db";
import { requireAuth } from "../auth";

export const galleryRouter = Router();

const COLS = "id, url, caption, uploaded_by, approved, created_at";
const requireApproval = () => String(process.env.GALLERY_REQUIRE_APPROVAL || "").toLowerCase() === "true";

function cloudConfigured(): boolean {
  return !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
}
function configureCloud(): void {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  } else {
    cloudinary.config({ secure: true }); // reads CLOUDINARY_URL from the environment
  }
}

// Guests see approved photos only; the admin sees everything (including pending).
galleryRouter.get("/", requireAuth(), async (req, res) => {
  const sql =
    req.role === "admin"
      ? `SELECT ${COLS} FROM gallery_photos ORDER BY created_at DESC`
      : `SELECT ${COLS} FROM gallery_photos WHERE approved = true ORDER BY created_at DESC`;
  const { rows } = await pool.query(sql);
  res.json(rows);
});

// Any signed-in guest can submit a photo — the file is already hosted on Cloudinary,
// we only store its URL. We reject non-Cloudinary URLs so nobody can inject arbitrary links.
const addSchema = z.object({
  url: z.string().url().max(2000),
  caption: z.string().max(200).optional().default(""),
  uploadedBy: z.string().max(120).optional().default(""),
});

galleryRouter.post("/", requireAuth(), async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid photo" });
  const { url, caption, uploadedBy } = parsed.data;
  if (!/^https:\/\/res\.cloudinary\.com\//i.test(url)) {
    return res.status(400).json({ error: "Unsupported image host" });
  }
  const { rows } = await pool.query(
    `INSERT INTO gallery_photos (url, caption, uploaded_by, approved)
     VALUES ($1,$2,$3,$4) RETURNING ${COLS}`,
    [url, caption.trim(), uploadedBy.trim(), !requireApproval()]
  );
  res.status(201).json(rows[0]);
});

// Admin: pull EXISTING assets from your Cloudinary account into the gallery.
// Uses the Admin API (needs CLOUDINARY_URL or cloud_name/key/secret on the server).
// Optional filters: CLOUDINARY_IMPORT_TAG or CLOUDINARY_IMPORT_FOLDER.
galleryRouter.post("/import", requireAuth(["admin"]), async (_req, res) => {
  if (!cloudConfigured()) {
    return res.status(400).json({ error: "Cloudinary admin credentials aren't set on the server (CLOUDINARY_URL)." });
  }
  configureCloud();
  try {
    const tag = process.env.CLOUDINARY_IMPORT_TAG;
    const folder = process.env.CLOUDINARY_IMPORT_FOLDER;
    const resources: any[] = [];
    let cursor: string | undefined = undefined;
    for (let page = 0; page < 5; page++) { // cap at ~500 images
      const opts: any = { max_results: 100, context: true, next_cursor: cursor };
      const result: any = tag
        ? await cloudinary.api.resources_by_tag(tag, opts)
        : await cloudinary.api.resources({ resource_type: "image", type: "upload", prefix: folder || undefined, ...opts });
      resources.push(...(result.resources || []));
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    let imported = 0;
    for (const r of resources) {
      const url: string | undefined = r.secure_url;
      if (!url) continue;
      const caption = String(r.context?.custom?.caption || r.context?.caption || "").slice(0, 200);
      const result = await pool.query(
        `INSERT INTO gallery_photos (url, caption, uploaded_by, approved)
         VALUES ($1, $2, '', true) ON CONFLICT (url) DO NOTHING`,
        [url, caption]
      );
      if (result.rowCount) imported += result.rowCount;
    }
    res.json({ imported, total: resources.length });
  } catch (e) {
    console.error("Cloudinary import failed:", e);
    res.status(502).json({ error: "Couldn't reach Cloudinary — check the server credentials." });
  }
});

// Admin moderation.
galleryRouter.patch("/:id/approve", requireAuth(["admin"]), async (req, res) => {
  const { rows } = await pool.query(`UPDATE gallery_photos SET approved = true WHERE id = $1 RETURNING ${COLS}`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

galleryRouter.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  await pool.query("DELETE FROM gallery_photos WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
