# Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run `schema.sql` once.
3. In **Project Settings → API**, copy:
   - Project URL → Render variable `SUPABASE_URL`
   - Secret key, or legacy `service_role` key → Render variable `SUPABASE_SECRET_KEY`
4. Never put the secret key in Vercel, frontend source, or any `VITE_` variable.

The schema stores:

- `monitoring_current`: one upserted row containing the newest normalized snapshot.
- `monitoring_snapshots`: periodic historical snapshots.

Default behavior:

- Scrape every 5 minutes.
- Update `monitoring_current` after every scrape.
- Save one history row per hour.
- Delete history older than 30 days.

Change those defaults with Render environment variables:

```text
SCRAPE_INTERVAL_SECONDS=300
HISTORY_INTERVAL_SECONDS=3600
HISTORY_RETENTION_DAYS=30
```

Both tables have RLS enabled and grant no browser access. The Render backend is the only component that uses the secret key.
