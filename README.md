# prrrtpal-housewarming-theme

The housewarming event app under the **Pr³Tpal** umbrella (*Plan • Invite • Celebrate*) — a private, passcode-gated party site the host runs end-to-end: invites, RSVP, potluck signup, photo gallery, house-predictions game, Game Center, and a gift registry with claim/reserve mechanics.

Built as a standalone event instance; each Pr³Tpal event app shares the same architecture (React/Vite frontend on Cloudflare Pages, Express/TypeScript API on Render, Neon Postgres, Cloudinary media).

## Features

- **Passcode roles** — separate guest, admin (host), and family codes; JWT sessions; the family code unlocks the keepsake view of reserved gifts, cards, and messages.
- **Host panel** — everything is live-editable without a redeploy: event details, section visibility toggles, and the **site theme picker** (🏡 Warm home / 🏖️ Summer pool, each with day + night variants).
- **RSVP** — yes/maybe/no with headcount, optional PIN so guests can edit their reply from any device, CSV export.
- **Bring a Dish** — categorized potluck signup.
- **Photo gallery** — multi-photo guest uploads via Cloudinary unsigned preset, optional admin approval, lightbox, party-day gating.
- **House Predictions** — guests lock in predictions; answers stay hidden until the party (admin sees all).
- **Game Center** — host uploads photos of the games on hand (board games, yard games, pool toys) so guests can browse what's available.
- **Registry** — items from any store, claim/reserve so no one buys doubles, CSV/Excel bulk import with ASIN dedup, reservation export, ecards + voice messages on reserved gifts.

## Stack

| Layer | Tech | Deploys to |
|---|---|---|
| Frontend | React 18, Vite, Tailwind, PWA | Cloudflare Pages |
| Backend | Express, TypeScript (`tsx watch` in dev) | Render (`render.yaml` blueprint) |
| Database | Postgres — schema auto-creates on boot (`CREATE TABLE IF NOT EXISTS`) | Neon (prod) / local or Neon branch (dev) |
| Media | Cloudinary (images, audio) via unsigned upload preset | — |

## Local development

Two processes: the API on **:3000** and Vite on **:5173**.

### 1. Pick a dev database (never production)

**Option A — local Postgres.** The connection code disables SSL automatically for any `localhost` URL, so a native or Docker Postgres works out of the box:

```bash
createdb housewarming        # native install
# or
docker run --name housewarming-pg -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=housewarming -p 5432:5432 -d postgres:16
```

**Option B — Neon dev branch.** Create a branch in the Neon console and copy its **pooled** connection string (host contains `-pooler`, keep `?sslmode=require`).

There are no migrations to run — `initDb()` creates all tables on first boot.

### 2. Backend

```bash
cd backend
cp .env.example .env         # then edit: DATABASE_URL, JWT_SECRET, passcodes
npm install
npm run dev                  # tsx watch → http://localhost:3000
```

Boot is healthy when you see `🏡 housewarming-api listening on :3000` and `GET /` returns `{"ok":true}`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env         # VITE_API_URL defaults to http://localhost:3000
npm install
npm run dev                  # → http://localhost:5173
```

### Gotchas that have bitten before

- **`.env` is read only at boot.** `tsx watch` reloads on `src` changes, not `.env` changes — fully restart `npm run dev` after editing env files. Same for Vite: env vars are baked at build time.
- **CORS**: `CLIENT_ORIGIN` must include `http://localhost:5173` in dev (comma-separate to add production; no spaces around commas).
- **Port 5432 conflicts**: a native Mac Postgres (Homebrew/Postgres.app) may already own 5432 with a superuser named after your macOS account — `role "postgres" does not exist` means you hit that server, not Docker. Either use the native one (Option A `createdb`) or map Docker to another port.

## Configuration

All env vars are documented inline in [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example). The `EVENT_*` vars only seed the first boot; after that the host edits everything live from the Host panel (stored in the `settings` table).

**Secrets policy:** `.env` files are gitignored and must stay that way. Production `DATABASE_URL` belongs only in Render's environment tab; local dev always points at a local DB or a Neon branch. If a credential ever lands in a commit, rotate it.

## Verification

Run before committing — all three gates should pass:

```bash
cd backend  && npx tsc --noEmit          # strict backend typecheck
cd frontend && npx tsc --noEmit          # strict frontend typecheck
cd frontend && npm run build             # Vite production build
```

SQL-level behavior (schema idempotency, JSONB round-trips) is covered by PGlite runtime tests during development — TypeScript alone can't catch those.

## Deploy

1. **Database** — create a Neon project; copy the pooled connection string.
2. **API** — on Render: *New + → Blueprint* pointed at this repo (`render.yaml` defines `prrrtpal-housewarming-api`); paste `DATABASE_URL`, passcodes, and `CLIENT_ORIGIN` in the dashboard (`JWT_SECRET` is generated).
3. **Frontend** — on Cloudflare Pages: root dir `frontend`, build `npm run build`, output `dist`; set `VITE_API_URL` to the Render URL plus the `VITE_CLOUDINARY_*` vars.
4. Add the Pages URL to `CLIENT_ORIGIN` on Render and redeploy the API.

## Notes

- `frontend/public/intro.mp4` is the one-time welcome video shown on first unlock — replace it with your own clip (or delete the file and the `IntroVideo` usage in `App.tsx` to skip the intro).
- The site theme (`warm` / `pool`) is host-editable at runtime; `EVENT_THEME_NAME` only sets the initial default. Adding a new theme is one entry in the `THEMES` map in `App.tsx` plus the enum in `backend/src/routes/admin.ts` and `backend/src/config.ts`.
