import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../auth";

export const predictionsRouter = Router();
predictionsRouter.use(requireAuth());

// The game: guests write down their predictions about the new house. Everyone
// can see how many people have played; only the host and the family see the
// actual answers (so the reveal stays a party moment, not a spoiler feed).
predictionsRouter.get("/", async (req, res) => {
  const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS n FROM predictions");
  const count = countRows[0].n as number;
  if (req.role !== "admin" && req.role !== "family") {
    return res.json({ count, entries: null });
  }
  const { rows } = await pool.query(
    "SELECT id, name, answers, created_at FROM predictions ORDER BY created_at ASC"
  );
  res.json({ count, entries: rows });
});

const submitSchema = z.object({
  name: z.string().min(1).max(120),
  // question-id -> answer text. Question ids are defined in the frontend so the
  // question list can evolve without a schema migration.
  answers: z.record(z.string().min(1).max(60), z.string().max(300)),
});

predictionsRouter.post("/", async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid prediction" });
  const { name, answers } = parsed.data;
  // Drop empty answers so the stored jsonb only holds what the guest actually wrote.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    const t = v.trim();
    if (t) cleaned[k] = t;
  }
  if (Object.keys(cleaned).length === 0) return res.status(400).json({ error: "Answer at least one question" });
  const { rows } = await pool.query(
    `INSERT INTO predictions (name, answers) VALUES ($1, $2::jsonb)
     RETURNING id, name, answers, created_at`,
    [name.trim(), JSON.stringify(cleaned)]
  );
  res.status(201).json(rows[0]);
});

// Host cleanup of a single entry (bulk clear lives in /api/admin/clear).
predictionsRouter.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  await pool.query("DELETE FROM predictions WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
