import { Router } from "express";
import { z } from "zod";
import { pool, setSections, setContent } from "../db";
import { requireAuth } from "../auth";

export const adminRouter = Router();
adminRouter.use(requireAuth(["admin"])); // admin token ONLY

const clearSchema = z.object({
  scope: z.enum(["rsvps", "potluck", "gifts", "wishlist", "predictions", "games", "all"]),
});

const TABLES: Record<string, string[]> = {
  rsvps: ["rsvps"],
  potluck: ["potluck_items"],
  gifts: ["gift_claims"],
  wishlist: ["gift_claims", "wishlist_items"], // clear reservations first, then the gift items
  predictions: ["predictions"],
  games: ["game_center_items"], // host-curated, so (like wishlist) NOT part of "all"
  all: ["rsvps", "potluck_items", "gift_claims", "predictions"],
};

adminRouter.post("/clear", async (req, res) => {
  const parsed = clearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid scope" });
  for (const t of TABLES[parsed.data.scope]) {
    await pool.query(`DELETE FROM ${t}`); // table names are from a fixed allow-list, never user input
  }
  res.json({ ok: true, cleared: parsed.data.scope });
});

// Toggle which sections guests can see. Send any subset of the flags.
const sectionsSchema = z.object({
  countdown: z.boolean().optional(),
  details: z.boolean().optional(),
  rsvp: z.boolean().optional(),
  food: z.boolean().optional(),
  photos: z.boolean().optional(),
  gifts: z.boolean().optional(),
  game: z.boolean().optional(),
  gameCenter: z.boolean().optional(),
});

adminRouter.patch("/sections", async (req, res) => {
  const parsed = sectionsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid sections" });
  const next = await setSections(parsed.data);
  res.json(next);
});

// Edit the live event details (name, date, venue, host note, …). Send any subset
// of fields; the rest are left unchanged. Admin token only (router-level guard).
const contentSchema = z
  .object({
    themeName: z.enum(["warm", "pool"]),
    requireRsvpApproval: z.boolean(),
    guestCodeEnabled: z.boolean(),
    requireEmail: z.boolean(),
    requirePhone: z.boolean(),
    familyName: z.string().min(1).max(80),
    tagline: z.string().max(200),
    partyDate: z.string().min(1).max(40),
    timeLabel: z.string().max(80),
    venueName: z.string().max(160),
    address: z.string().max(240),
    hostNote: z.string().max(2000),
    rsvpDeadline: z.string().max(80),
    dishCategories: z.array(z.string().min(1).max(40)).max(20),
    registryUrl: z.string().max(500),
  })
  .partial()
  .strict();

adminRouter.patch("/content", async (req, res) => {
  const parsed = contentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid event details" });
  const next = await setContent(parsed.data);
  res.json(next);
});
