import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../auth";

export const potluckRouter = Router();
potluckRouter.use(requireAuth());

potluckRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, category, name, dish, created_at FROM potluck_items ORDER BY created_at ASC"
  );
  res.json(rows);
});

const dishSchema = z.object({
  category: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  dish: z.string().min(1).max(160),
});

potluckRouter.post("/", async (req, res) => {
  const parsed = dishSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid dish" });
  const { category, name, dish } = parsed.data;
  const { rows } = await pool.query(
    `INSERT INTO potluck_items (category, name, dish)
     VALUES ($1, $2, $3)
     RETURNING id, category, name, dish, created_at`,
    [category.trim(), name.trim(), dish.trim()]
  );
  res.status(201).json(rows[0]);
});

// Admin-only: edit an existing dish. Send any subset of fields.
const dishPatchSchema = z.object({
  category: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(120).optional(),
  dish: z.string().min(1).max(160).optional(),
});

potluckRouter.patch("/:id", requireAuth(["admin"]), async (req, res) => {
  const parsed = dishPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid dish" });
  const { rows: cur } = await pool.query(
    "SELECT category, name, dish FROM potluck_items WHERE id = $1",
    [req.params.id]
  );
  if (cur.length === 0) return res.status(404).json({ error: "Dish not found" });
  const p = parsed.data;
  const { rows } = await pool.query(
    `UPDATE potluck_items SET category = $1, name = $2, dish = $3
     WHERE id = $4
     RETURNING id, category, name, dish, created_at`,
    [(p.category ?? cur[0].category).trim(), (p.name ?? cur[0].name).trim(), (p.dish ?? cur[0].dish).trim(), req.params.id]
  );
  res.json(rows[0]);
});

potluckRouter.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM potluck_items WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
