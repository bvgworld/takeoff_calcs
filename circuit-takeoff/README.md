# Circuit Takeoff

Phase 1 — upload an electrical plan, calibrate scale, stamp devices, auto-route circuits, export takeoff.

**Stack:** Next.js 14 (App Router) · Tailwind · Supabase · pdfjs-dist · react-konva · Vercel

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor (creates tables, RLS, `plans` storage bucket policies).
3. In Supabase Auth → URL configuration, add redirect:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR_DOMAIN/auth/callback`
4. Copy env vars:

```bash
cp .env.local.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
```

5. Install and run:

```bash
npm install
npm run dev
```

## Deploy (Vercel)

- Root Directory: `circuit-takeoff` (if this repo also contains `branch-circuit-trainer`)
- Framework: Next.js
- Env: same `NEXT_PUBLIC_SUPABASE_*` vars
- Add the production `/auth/callback` URL in Supabase

## Workflow

1. Sign in with magic link
2. Create a project → set ceiling / stub / waste / MC vs EMT
3. Upload a PDF (page 1 is rasterized to PNG at ~150 DPI; both stored)
4. Calibrate: enter known feet → click two points on the plan
5. Stamp panel / fixtures / receptacles / switches
6. Create circuits (or Auto-group) → assign devices → Route
7. Drag bend points with **Edit route** · review code checks · export CSV

## Out of scope (Phase 2/3)

AI detection, wall-aware A* routing, multi-user, schedules, labor/pricing, mobile-first layout.
