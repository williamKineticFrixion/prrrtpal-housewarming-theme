import { Router } from "express";
import { z } from "zod";
import { roleForPasscode, signToken, requireAuth } from "../auth";
import { getSections, getContent } from "../db";
import { PUBLIC_EVENT, PRIVATE_EVENT } from "../config";

export const metaRouter = Router();

// Public branding for the gate screen (no address, no sensitive data).
// familyName comes from live host-edited content; defaultTheme stays env-set.
metaRouter.get("/public", async (_req, res) => {
  const c = await getContent();
  res.json({ familyName: c.familyName, defaultTheme: PUBLIC_EVENT.defaultTheme, themeName: c.themeName });
});

// Exchange a passcode for a 7-day token. Rate-limited in index.ts.
const authSchema = z.object({ passcode: z.string().min(1).max(200) });
metaRouter.post("/auth", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Passcode required" });
  const role = roleForPasscode(parsed.data.passcode);
  if (!role) return res.status(401).json({ error: "That code didn't work" });
  // Host can close guest entry (Host panel toggle). Admin + family still get in.
  if (role === "guest") {
    const content = await getContent();
    if (!content.guestCodeEnabled) {
      return res.status(403).json({ error: "Guest entry is currently closed", code: "guest_closed" });
    }
  }
  res.json({ role, token: signToken(role) });
});

// Full event details — protected. Only reachable with a valid token.
// Live host-edited content overrides the .env defaults; wishlist is omitted
// (it lives in the DB, see /api/wishlist).
metaRouter.get("/event", requireAuth(), async (req, res) => {
  const { wishlist: _seed, ...eventResponse } = PRIVATE_EVENT;
  const [sections, content] = await Promise.all([getSections(), getContent()]);
  // Guests only get the address once the host approves their RSVP (see
  // /api/rsvps/:id/access). Admin + family always see it. Redaction happens
  // HERE, server-side — the address never reaches an unapproved guest's browser.
  const locked = req.role === "guest" && content.requireRsvpApproval;
  res.json({ ...eventResponse, ...content, address: locked ? "" : content.address, addressLocked: locked, sections });
});
