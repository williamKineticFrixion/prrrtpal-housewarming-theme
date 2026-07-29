import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
export type Role = "guest" | "admin" | "family";

/** Map a submitted passcode to a role (server-side secrets — never shipped to the client).
 *  FAMILY_PASSCODE unlocks the family keepsake view. */
export function roleForPasscode(code: string | undefined): Role | null {
  const c = (code || "").trim();
  if (!c) return null;
  if (process.env.ADMIN_PASSCODE && c === process.env.ADMIN_PASSCODE) return "admin";
  const familyCode = process.env.FAMILY_PASSCODE;
  if (familyCode && c === familyCode) return "family";
  if (process.env.GUEST_PASSCODE && c === process.env.GUEST_PASSCODE) return "guest";
  return null;
}

// PIN hash covers name+pin together, so one indexed lookup verifies both.
// (Kept here so both the RSVP routes and the name+PIN sign-in share it.)
import { createHash } from "crypto";
export const hashGuestPin = (name: string, pin: string) =>
  createHash("sha256").update(`${name.trim().toLowerCase()}:${pin}`).digest("hex");

export function signToken(role: Role): string {
  return jwt.sign({ role }, SECRET, { expiresIn: "30d" }); // long-lived: party guests should not have to re-enter codes
}

// Augment Express Request with the verified role.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      role?: Role;
    }
  }
}

/** Require a valid token. Pass allowed roles to restrict (e.g. ["admin"]). */
export function requireAuth(allowed?: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    try {
      const payload = jwt.verify(token, SECRET) as { role: Role };
      if (allowed && !allowed.includes(payload.role)) {
        return res.status(403).json({ error: "Not allowed" });
      }
      req.role = payload.role;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
