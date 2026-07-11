# Deployment checklist

## Supabase

- [ ] Create project.
- [ ] Run `supabase/schema.sql` in SQL Editor.
- [ ] Copy project URL.
- [ ] Create/copy a server-side secret key.
- [ ] Confirm `monitoring_current` and `monitoring_snapshots` exist.

## GitHub

- [ ] Rotate previously exposed monitoring credentials and sessions.
- [ ] Create a private repository.
- [ ] Push this cleaned bundle only.
- [ ] Confirm no `Cookies.json`, `.har`, `.env`, browser profile, `node_modules`, or `dist` is tracked.

## Render

- [ ] Create Blueprint from the repository.
- [ ] Set `SUPABASE_URL`.
- [ ] Set `SUPABASE_SECRET_KEY`.
- [ ] Set `HUAWEI_USERNAME` and `HUAWEI_PASSWORD`.
- [ ] Set fresh `HUAWEI_COOKIES_JSON` and `KEHUA_COOKIES_JSON`.
- [ ] Temporarily set `FRONTEND_ORIGIN=*`.
- [ ] Confirm `/health` returns 200.
- [ ] Confirm `/ready` eventually returns 200.
- [ ] Confirm `/api/current` returns normalized JSON.

## Vercel

- [ ] Import the same repository.
- [ ] Set Root Directory to `frontend`.
- [ ] Set `VITE_API_URL` to the Render origin.
- [ ] Set `VITE_POLL_INTERVAL_MS=60000`.
- [ ] Deploy and test the dashboard.

## Final CORS lock-down

- [ ] Replace Render `FRONTEND_ORIGIN=*` with the exact Vercel origin.
- [ ] Redeploy Render.
- [ ] Confirm the dashboard still loads.
