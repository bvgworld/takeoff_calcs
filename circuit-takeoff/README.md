# Circuit Takeoff

Phase 1 — Perry Electrical. Built prompt-by-prompt.

**Stack:** Next.js 14 · Tailwind · Supabase · pdfjs-dist · react-konva · Vercel

## Setup

1. Create a Supabase project.
2. Run SQL migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_storage_plans_by_project.sql`
3. Auth → URL config: add `http://localhost:3000/auth/callback` (+ prod URL).
4. Env:

```bash
cp .env.local.example .env.local
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
```

5. `npm install && npm run dev`

## Deploy (Vercel)

Root Directory: `circuit-takeoff`. Set the same env vars. Add prod `/auth/callback` in Supabase.
