# ABBAHGAMJI — Backend (API only)

Express API for products, orders, accounts, reviews, coupons, analytics and
Flutterwave payment verification. Data lives in **Supabase (Postgres)**.
Deploys to **Vercel** as serverless functions.

This project no longer serves the storefront/admin HTML — that now lives in
the separate `frontend/` project, talking to this API over `fetch()`.

## 1. Create the Supabase project

1. https://supabase.com → New project.
2. Once it's ready: **SQL Editor → New query** → paste the entire contents of
   `supabase-schema.sql` from this folder → **Run**. This creates all tables
   and seeds the starter product catalog + two coupons (`WELCOME10`, `FREESHIP`).
3. **Settings → API** → copy the **Project URL** and the **`service_role`**
   secret key (not `anon`). You'll need both in step 3 below.

## 2. Install & configure locally (optional, for testing before deploy)

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env`:
- `JWT_SECRET`, `ADMIN_TOKEN` — any long random strings (see comments in the file)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from step 1
- `FLW_SECRET_KEY` — Flutterwave dashboard → Settings → API Keys (start with the **test** key)
- `FRONTEND_URL` — leave blank locally, or your deployed frontend URL

```bash
npm start
```

API runs at `http://localhost:4000` — try `http://localhost:4000/api/products`.

## 3. Deploy to Vercel

1. Push this `backend/` folder to a GitHub repo (its own repo, separate from `frontend/`).
2. https://vercel.com → **Add New → Project** → import that repo.
3. **Environment Variables** — add every variable from `.env.example`:
   `JWT_SECRET`, `ADMIN_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `FLW_SECRET_KEY`, `FRONTEND_URL` (your frontend's Vercel URL, e.g.
   `https://abbahgamji.vercel.app`).
4. Deploy. Vercel gives you a URL like `https://abbahgamji-backend.vercel.app`.
5. Confirm it's alive: open that URL — you should see `{"ok":true,"service":"ABBAHGAMJI API"}`.

Then open `https://your-backend.vercel.app/api/products` — you should see the
seeded product catalog as JSON.

## The admin login

**There is no built-in admin username/password shipped with this project —
by design.** The admin dashboard's "password" field checks against
`ADMIN_TOKEN`, an environment variable **you set yourself** in step 3. Nothing
is hardcoded anywhere in the code, so there's nothing to "look up" — you
choose the value when you deploy. Whatever you type into `ADMIN_TOKEN` in
Vercel's environment variables **is** the admin login (the username field on
the login screen is just a label; only the token/password matters).

Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## API endpoints

| Method | Path                          | Auth   | Purpose |
|--------|-------------------------------|--------|---------|
| POST   | /api/auth/register            | —      | Create a customer account |
| POST   | /api/auth/login               | —      | Log in, get a token |
| POST   | /api/auth/magic-link          | —      | Request a passwordless login link |
| POST   | /api/auth/magic-login         | —      | Redeem a magic-link token |
| GET    | /api/auth/me                  | token  | Current customer's profile |
| PUT    | /api/auth/measurements        | token  | Save tailor's measurements |
| GET    | /api/products                 | —      | List products (optional `?category=`) |
| POST   | /api/products                 | admin  | Add a product |
| PUT    | /api/products/:id              | admin  | Edit a product |
| DELETE | /api/products/:id              | admin  | Remove a product |
| POST   | /api/orders                   | —      | Place an order |
| GET    | /api/orders/track?query=...   | —      | Look up an order by ID or phone |
| GET    | /api/orders                   | admin  | List every order |
| PATCH  | /api/orders/:id/status         | admin  | Update an order's delivery stage |
| GET    | /api/orders/export             | admin  | Download orders as CSV |
| POST   | /api/payments/verify           | —      | Verify a Flutterwave transaction |
| GET    | /api/customers                 | admin  | List customer accounts |
| GET    | /api/reviews?productId=        | —      | Approved reviews for a product |
| POST   | /api/reviews                   | —      | Submit a review |
| DELETE | /api/reviews/:id                | admin  | Unpublish a review |
| GET/POST/PATCH/DELETE | /api/coupons            | admin* | Manage coupons (`/validate` is public) |
| GET    | /api/analytics/summary          | admin  | Dashboard analytics |

"admin" routes expect `Authorization: Bearer <ADMIN_TOKEN>`.
"token" routes expect `Authorization: Bearer <token>` from `/api/auth/login`.

## What changed from the original single-project version

- Storage moved from a local `db.json` file (lowdb) to **Supabase Postgres** —
  a file on disk doesn't persist on Vercel's serverless filesystem, so the
  original version would have silently lost all data on every deploy/cold start.
- The static `public/` folder (storefront + admin HTML) was pulled out into
  its own `frontend/` project, since Vercel serves static sites and Node APIs
  most simply as separate projects. CORS is now open (`app.use(cors())`)
  since the two now live on different origins; auth is via Bearer token, not
  cookies, so this doesn't weaken anything.
- `server.js` no longer calls `app.listen()` when running on Vercel —
  `api/index.js` exports the Express app directly, which is how Vercel's
  Node runtime expects a serverless handler.
