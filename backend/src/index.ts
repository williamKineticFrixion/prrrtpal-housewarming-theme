import "dotenv/config"; // MUST be first — loads .env before any module reads process.env
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { initDb, seedWishlist } from "./db";
import { metaRouter } from "./routes/meta";
import { rsvpRouter } from "./routes/rsvps";
import { potluckRouter } from "./routes/potluck";
import { giftRouter } from "./routes/gifts";
import { wishlistRouter } from "./routes/wishlist";
import { galleryRouter } from "./routes/gallery";
import { adminRouter } from "./routes/admin";
import { predictionsRouter } from "./routes/predictions";
import { gamesRouter } from "./routes/games";

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct rate-limit IPs

// Allow your Cloudflare Pages origin(s). Comma-separate for multiple (e.g. prod + a preview).
const origins = (process.env.CLIENT_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: "100kb" }));

// Health check (also the URL an uptime pinger should hit to keep Render warm).
app.get("/", (_req, res) => res.json({ ok: true, service: "housewarming-api" }));

// Throttle passcode guessing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use("/api/auth", authLimiter);

app.use("/api", metaRouter); // /api/public, /api/auth, /api/event
app.use("/api/rsvps", rsvpRouter);
app.use("/api/potluck", potluckRouter);
app.use("/api/gifts", giftRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/gallery", galleryRouter);
app.use("/api/predictions", predictionsRouter);
app.use("/api/games", gamesRouter);
app.use("/api/admin", adminRouter);

// Catch async errors so the process never crashes on a bad query.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const port = Number(process.env.PORT || 3000);
initDb()
  .then(seedWishlist)
  .then(() => app.listen(port, () => console.log(`🏡 housewarming-api listening on :${port}`)))
  .catch((e) => {
    console.error("Failed to init DB:", e);
    process.exit(1);
  });
