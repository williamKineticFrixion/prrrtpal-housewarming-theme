import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import rateLimit from "express-rate-limit";
import { pool, getContent } from "../db";
import { requireAuth } from "../auth";

export const rsvpRouter = Router();
rsvpRouter.use(requireAuth()); // any signed-in guest or admin

// PIN is bound to the (normalized) name so name+PIN identifies one RSVP.
// Note: a short PIN is light security — the real protection is the rate limiter below.
import { hashGuestPin as hashPin } from "../auth";

// Throttle PIN lookups so a 4-digit PIN can't be brute-forced over the API.
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });

// email/phone are returned, but the frontend only shows them to the admin.
rsvpRouter.get("/", async (req, res) => {
  // What each role may see (enforced HERE, not in the UI):
  //  - guest:  names of confirmed "yes" guests only, plus the aggregate
  //            headcount — no party sizes, messages, contact info, or maybes.
  //  - family: full list minus contact info.
  //  - admin:  everything.
  if (req.role === "guest") {
    const [names, agg] = await Promise.all([
      pool.query("SELECT name FROM rsvps WHERE status = 'yes' ORDER BY created_at DESC"),
      pool.query("SELECT COALESCE(SUM(party_size), 0)::int AS total FROM rsvps WHERE status = 'yes'"),
    ]);
    return res.json({ names: names.rows.map((r) => r.name), totalGoing: agg.rows[0].total });
  }
  const contact = req.role === "admin" ? "email, phone, " : "";
  const { rows } = await pool.query(
    `SELECT id, name, status, party_size, message, ${contact}approved, created_at FROM rsvps ORDER BY created_at DESC`
  );
  res.json(rows);
});

const rsvpSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(["yes", "maybe", "no"]),
  partySize: z.number().int().min(0).max(50),
  message: z.string().max(500).optional().default(""),
  email: z.union([z.string().email(), z.literal("")]).optional().default(""), // valid email or blank
  phone: z.string().max(40).optional().default(""),
  pin: z.string().min(3).max(20).optional(), // optional: lets the guest edit from any device later
});

rsvpRouter.post("/", async (req, res) => {
  const parsed = rsvpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid RSVP" });
  const { name, status, partySize, message, email, phone, pin } = parsed.data;
  const size = status === "no" ? 0 : Math.max(1, partySize);
  const editToken = randomUUID(); // secret handed to this guest so they can edit their own entry
  const pinHash = pin ? hashPin(name, pin) : null;
  const { rows } = await pool.query(
    `INSERT INTO rsvps (name, attending, status, party_size, message, email, phone, edit_token, pin_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, status, party_size, message, email, phone, approved, created_at`,
    [name.trim(), status === "yes", status, size, message.trim(), email.trim(), phone.trim(), editToken, pinHash]
  );
  res.status(201).json({ ...rows[0], editToken });
});

// Recover an RSVP from any device using name + PIN. Returns the edit token on a match.
const lookupSchema = z.object({ name: z.string().min(1).max(120), pin: z.string().min(3).max(20) });
rsvpRouter.post("/lookup", lookupLimiter, async (req, res) => {
  const parsed = lookupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your name and PIN." });
  const hash = hashPin(parsed.data.name, parsed.data.pin);
  const { rows } = await pool.query(
    "SELECT id, name, status, party_size, message, email, phone, edit_token FROM rsvps WHERE pin_hash = $1",
    [hash]
  );
  if (rows.length === 0) return res.status(404).json({ error: "No RSVP found with that name and PIN." });
  if (rows.length > 1) return res.status(409).json({ error: "More than one match — please ask the host to help." });
  const row = rows[0];
  let token = row.edit_token;
  if (!token) { token = randomUUID(); await pool.query("UPDATE rsvps SET edit_token = $1 WHERE id = $2", [token, row.id]); }
  res.json({ id: row.id, editToken: token, name: row.name, status: row.status, party_size: row.party_size, message: row.message, email: row.email, phone: row.phone });
});

// Shared validation for partial edits (used by both admin and guest self-edit).
const rsvpPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["yes", "maybe", "no"]).optional(),
  partySize: z.number().int().min(0).max(50).optional(),
  message: z.string().max(500).optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  phone: z.string().max(40).optional(),
});

// Guest self-service edit: must be signed in AND present the secret edit token for this row.
// This is what lets someone fix their own RSVP without being able to touch anyone else's.
rsvpRouter.patch("/:id/self", async (req, res) => {
  const parsed = rsvpPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid RSVP" });
  const token = String(req.body?.editToken || "");
  if (!token) return res.status(403).json({ error: "Missing edit token" });

  const { rows: cur } = await pool.query(
    "SELECT name, status, party_size, message, email, phone, edit_token FROM rsvps WHERE id = $1",
    [req.params.id]
  );
  if (cur.length === 0) return res.status(404).json({ error: "RSVP not found" });
  if (!cur[0].edit_token || cur[0].edit_token !== token) return res.status(403).json({ error: "Not allowed" });

  const p = parsed.data;
  const status = p.status ?? cur[0].status;
  const rawSize = p.partySize ?? cur[0].party_size;
  const size = status === "no" ? 0 : Math.max(1, rawSize);
  const { rows } = await pool.query(
    `UPDATE rsvps SET name = $1, attending = $2, status = $3, party_size = $4, message = $5, email = $6, phone = $7
     WHERE id = $8
     RETURNING id, name, status, party_size, message, email, phone, created_at`,
    [
      (p.name ?? cur[0].name).trim(), status === "yes", status, size,
      (p.message ?? cur[0].message ?? "").trim(), (p.email ?? cur[0].email ?? "").trim(), (p.phone ?? cur[0].phone ?? "").trim(),
      req.params.id,
    ]
  );
  res.json(rows[0]);
});

// Admin-only: approve or revoke a guest's RSVP. Approval is what unlocks the
// party address + directions for that guest (when requireRsvpApproval is on).
const approveSchema = z.object({ approved: z.boolean() });
rsvpRouter.patch("/:id/approve", requireAuth(["admin"]), async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const { rows } = await pool.query(
    `UPDATE rsvps SET approved = $2 WHERE id = $1
     RETURNING id, name, status, party_size, message, email, phone, approved, created_at`,
    [req.params.id, parsed.data.approved]
  );
  if (rows.length === 0) return res.status(404).json({ error: "RSVP not found" });
  res.json(rows[0]);
});

// Guest address unlock: prove you own this RSVP (the edit token handed out at
// creation, recoverable via name+PIN) and, if the host has approved it, get the
// address + venue. This is the ONLY way an unapproved guest's client can ask
// for the address — and it won't get one until approved=true.
rsvpRouter.post("/:id/access", async (req, res) => {
  const token = String(req.body?.editToken || "");
  if (!token) return res.status(403).json({ error: "Missing edit token" });
  const { rows } = await pool.query(
    "SELECT id, name, status, party_size, message, email, phone, edit_token, approved FROM rsvps WHERE id = $1",
    [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "RSVP not found" });
  if (!rows[0].edit_token || rows[0].edit_token !== token) return res.status(403).json({ error: "Not allowed" });
  // Your own row, token-proven — safe to return in full (it's your data).
  const { edit_token: _t, ...self } = rows[0];
  if (!rows[0].approved) return res.json({ approved: false, self });
  const content = await getContent();
  res.json({ approved: true, address: content.address, venueName: content.venueName, self });
});

// Admin-only: edit an existing RSVP. Send any subset of fields.
rsvpRouter.patch("/:id", requireAuth(["admin"]), async (req, res) => {
  const parsed = rsvpPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid RSVP" });

  // Read current row so we can recompute derived fields and only change what's sent.
  const { rows: cur } = await pool.query(
    "SELECT name, status, party_size, message, email, phone FROM rsvps WHERE id = $1",
    [req.params.id]
  );
  if (cur.length === 0) return res.status(404).json({ error: "RSVP not found" });

  const p = parsed.data;
  const status = p.status ?? cur[0].status;
  const rawSize = p.partySize ?? cur[0].party_size;
  const size = status === "no" ? 0 : Math.max(1, rawSize);

  const { rows } = await pool.query(
    `UPDATE rsvps SET
       name = $1, attending = $2, status = $3, party_size = $4, message = $5, email = $6, phone = $7
     WHERE id = $8
     RETURNING id, name, status, party_size, message, email, phone, created_at`,
    [
      (p.name ?? cur[0].name).trim(),
      status === "yes",
      status,
      size,
      (p.message ?? cur[0].message ?? "").trim(),
      (p.email ?? cur[0].email ?? "").trim(),
      (p.phone ?? cur[0].phone ?? "").trim(),
      req.params.id,
    ]
  );
  res.json(rows[0]);
});

// Admin-only: delete a single RSVP.
rsvpRouter.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  await pool.query("DELETE FROM rsvps WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
