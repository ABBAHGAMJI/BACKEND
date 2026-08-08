-- ABBAHGAMJI — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: uses "if not exists" / "on conflict" where possible.

create extension if not exists pgcrypto;

-- ---------- products ----------
create table if not exists products (
  id bigint generated always as identity primary key,
  cat text not null,
  name text not null,
  price numeric not null,
  old_price numeric,
  img text,
  description text,
  stock integer not null default 20,
  low_stock_threshold integer not null default 5
);

-- ---------- users (storefront customers) ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  measurements jsonb,
  loyalty_points integer not null default 0
);

-- ---------- orders ----------
create table if not exists orders (
  id text primary key,
  items jsonb not null,
  subtotal numeric not null,
  discount numeric not null default 0,
  coupon_code text,
  points_redeemed integer not null default 0,
  points_earned integer not null default 0,
  total numeric not null,
  customer jsonb not null,
  estimated_delivery jsonb,
  user_id uuid references users(id) on delete set null,
  status text not null default 'Order Placed',
  paid boolean not null default false,
  tx_ref text,
  created_at timestamptz not null default now()
);

-- ---------- magic_links (passwordless customer login) ----------
create table if not exists magic_links (
  token_hash text primary key,
  email text not null,
  expires_at bigint not null,
  used boolean not null default false
);

-- ---------- order_links (emailed order verify/track tokens) ----------
create table if not exists order_links (
  token_hash text primary key,
  order_id text references orders(id) on delete cascade,
  email text not null,
  expires_at bigint not null,
  verified_at timestamptz
);

-- ---------- reviews ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id bigint references products(id) on delete cascade,
  name text not null,
  rating integer not null,
  comment text not null,
  created_at timestamptz not null default now(),
  approved boolean not null default true
);

-- ---------- coupons ----------
create table if not exists coupons (
  code text primary key,
  type text not null,
  value numeric not null,
  active boolean not null default true,
  min_spend numeric not null default 0,
  expires_at timestamptz,
  used_count integer not null default 0
);

-- Helpful indexes
create index if not exists idx_orders_created_at on orders(created_at);
create index if not exists idx_reviews_product_id on reviews(product_id);

-- ---------- seed data (same starter catalog as the original db.json) ----------
insert into products (id, cat, name, price, old_price, img, description, stock, low_stock_threshold) values
(17, 'Caps', 'Classic Embroidered Kufi Cap — Ivory', 8000, null, 'https://images.unsplash.com/photo-1521369909029-2afed882baee?q=80&w=800&auto=format&fit=crop', 'Hand-embroidered kufi cap, the finishing touch on any kaftan or agbada.', 24, 5),
(18, 'Caps', 'Classic Embroidered Kufi Cap — Charcoal', 8500, null, 'https://images.unsplash.com/photo-1521369909029-2afed882baee?q=80&w=800&auto=format&fit=crop&sat=-30', 'Understated tone, same fine hand-stitched detailing.', 20, 5),
(1, 'Kaftan', 'Premium Kaftan — Ivory Class', 45000, null, 'https://images.unsplash.com/photo-1617196701537-7329482cc9fe?q=80&w=800&auto=format&fit=crop', 'Clean-lined and breathable, cut for everyday distinction.', 20, 5),
(2, 'Jallabiya', 'Signature Jallabiya — Sandstone', 52000, null, 'https://images.unsplash.com/photo-1621072156002-e2fccdc0b176?q=80&w=800&auto=format&fit=crop', 'Relaxed, flowing, and finished by hand.', 20, 5),
(3, 'Senator Wear', 'Senator Wear — Classic Two-Piece', 38000, null, 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=800&auto=format&fit=crop', 'Sharp, structured, built for the boardroom.', 20, 5),
(4, 'Agbada', 'Ceremonial Agbada — Gold Embroidered', 95000, null, 'https://images.unsplash.com/photo-1583334204245-3b0eff0e0664?q=80&w=800&auto=format&fit=crop', 'Grand, embroidered, cut for full presence.', 20, 5),
(9, 'Hijab', 'Premium Hijab — Ivory Silk-Feel', 12000, null, 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?q=80&w=800&auto=format&fit=crop', 'Lightweight, opaque, drapes without slipping.', 20, 5),
(10, 'Hijab', 'Premium Hijab — Sandstone Chiffon', 13500, null, 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?q=80&w=800&auto=format&fit=crop&sat=-20', 'Soft chiffon finish with a matte, breathable feel.', 20, 5),
(11, 'Long Gown', 'Signature Long Gown — Emerald Abaya', 58000, null, 'https://images.unsplash.com/photo-1594736797933-d0401ba2fe65?q=80&w=800&auto=format&fit=crop', 'Flowing, floor-length, finished by hand with a clean silhouette.', 20, 5),
(12, 'Long Gown', 'Ceremonial Long Gown — Gold-Trim Kaftan Dress', 72000, null, 'https://images.unsplash.com/photo-1594736797933-d0401ba2fe65?q=80&w=800&auto=format&fit=crop&sat=-20', 'Grand, embroidered hemline, cut for occasions that call for presence.', 20, 5),
(13, 'Shoes', 'Classic Leather Slip-On', 32000, null, 'https://images.unsplash.com/photo-1518049362265-d5b2a6467637?q=80&w=800&auto=format&fit=crop', 'Hand-finished leather, built to pair with kaftan or gown alike.', 20, 5),
(14, 'Shoes', 'Embellished Occasion Heels', 41000, null, 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?q=80&w=800&auto=format&fit=crop', 'Subtle embellishment, comfortable heel, made for long occasions.', 20, 5),
(15, 'Handbags', 'Structured Leather Handbag — Sandstone', 45000, null, 'https://images.unsplash.com/photo-1591561954557-26941169b49e?q=80&w=800&auto=format&fit=crop', 'Clean-lined structure with a soft leather finish.', 20, 5),
(16, 'Handbags', 'Embroidered Occasion Clutch — Gold', 36000, null, 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?q=80&w=800&auto=format&fit=crop', 'Hand-embroidered detailing, sized for evenings out.', 20, 5),
(19, 'Perfume', 'Oud Signature Perfume — 50ml', 35000, 40000, 'https://images.unsplash.com/photo-1541643600914-78b084683601?q=80&w=800&auto=format&fit=crop', 'A deep, smoky oud with amber warmth — our signature house scent.', 20, 5),
(20, 'Perfume', 'Amber Musk Eau De Parfum — 50ml', 27000, null, 'https://images.unsplash.com/photo-1587017539504-67cfbddac569?q=80&w=800&auto=format&fit=crop', 'Warm musk and soft amber, light enough for everyday wear.', 20, 5)
on conflict (id) do nothing;

-- Keep the identity sequence ahead of the manually-numbered seed rows above,
-- so the next admin-added product doesn't collide with id 1..20.
select setval(pg_get_serial_sequence('products', 'id'), (select max(id) from products));

insert into coupons (code, type, value, active, min_spend, expires_at, used_count) values
('WELCOME10', 'percent', 10, true, 0, null, 0),
('FREESHIP', 'fixed', 3000, true, 30000, null, 0)
on conflict (code) do nothing;
