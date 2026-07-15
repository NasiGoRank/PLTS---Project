# Kehua automatic cookie and token refresh

Login page: https://energy.kehua.com/sellerLogin

Kehua authentication is now server-side and automatic. The backend does not need
a manually refreshed Kehua cookie export as long as these Render or local
environment variables are configured:

```text
KEHUA_USERNAME
KEHUA_PASSWORD
```

Do not store the real username, password, cookie value, or authorization token in
this file. Keep them only in `backend/.env` for local development and Render
environment variables for production.

## What problem this solves

The old flow depended on `KEHUA_COOKIES_JSON`. That cookie eventually expired.
When it expired, scheduled scrapes could no longer authenticate to Kehua, so the
backend could not fetch fresh data.

The new flow treats the cookie or token as disposable runtime state. Before every
Kehua scrape, the backend checks whether the current Kehua authorization still
works. If it does not work, the backend logs in again with `KEHUA_USERNAME` and
`KEHUA_PASSWORD`, receives a fresh authorization token, and continues the scrape
with that token.

## Runtime flow

This is the normal production path when `cron-job.org` calls Render:

```text
cron-job.org
  POST /api/refresh
  Authorization: Bearer REFRESH_SECRET
        |
        v
Render FastAPI backend
  1. Starts one refresh job.
  2. Builds a Kehua HTTP session.
  3. Loads optional KEHUA_COOKIES_JSON if present.
  4. Calls Kehua auth check.
  5. If the token is valid, uses it.
  6. If the token is expired, logs in with KEHUA_USERNAME and KEHUA_PASSWORD.
  7. Stores the new authorization token only in server memory.
  8. Scrapes Kehua API endpoints.
  9. Writes the normalized latest result and hourly history to Supabase.
        |
        v
Vercel frontend
  GET /api/current every 60 seconds
  Shows latest Supabase-backed data and last-updated status.
```

## How the backend refreshes Kehua auth

The relevant implementation is in `backend/scrape_monitoring.py`.

1. `prepare_session(...)` creates a new `requests.Session` for Kehua.
2. `load_cookies_into_session(...)` loads `KEHUA_COOKIES_JSON` if it exists.
   This is optional and is only used as a first attempt.
3. `kehua_check_auth(...)` calls Kehua's user-info endpoint to verify whether
   the session token is still accepted.
4. If the check fails, `kehua_password_login(...)` performs the same signed
   password login used by Kehua's web client.
5. The login response returns an `Authorization` token.
6. The backend puts that token into the session `Authorization` header and also
   sets it as a session cookie named `token`.
7. The scrape then continues using the refreshed in-memory session.

The generated token is not written back to `.env`, not returned to API clients,
and not stored in Supabase. It only lives inside the backend process for the
current scrape session.

## Why password login needs encryption and signing

Kehua's browser login does not send the raw password. The backend mirrors the
same public web-client protocol:

```text
raw password
  -> AES password encryption
  -> signed form request
  -> POST /necp/server-user/auth/web/login
  -> fresh Authorization token
```

The request signing matters because Kehua rejects ordinary username/password
form posts that do not match the web client's login format.

## Required environment variables

Production Render variables:

```text
KEHUA_USERNAME
KEHUA_PASSWORD
REFRESH_SECRET
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Optional variable:

```text
KEHUA_COOKIES_JSON
```

`KEHUA_COOKIES_JSON` can still be present, but it is no longer required for
Kehua when username and password login is configured. If the cookie is stale, the
backend will replace it in memory by logging in again.

## Failure behavior

If `KEHUA_USERNAME` or `KEHUA_PASSWORD` is missing and the current cookie is
expired, Kehua refresh cannot recover. The refresh metadata reports:

```text
credentials_not_configured
```

If Kehua changes its login encryption, request signing, or response format, the
password login can fail even with correct credentials. In that case, check
Render logs for the safe auth metadata fields:

```text
auth_check_before_login
password_login
auth_check_after_login
```

Those fields show success, HTTP status, Kehua app code, and whether an
authorization token was found. They intentionally do not include the password,
cookie, or token value.

## Local test

From the backend directory, with `backend/.env` configured:

```bash
cd backend
source .venv/bin/activate
python test_kehua_auth.py
```

For a live end-to-end refresh through the API:

```bash
uvicorn api:app --reload --host 0.0.0.0 --port 8000
curl -X POST http://127.0.0.1:8000/api/refresh \
  -H "Authorization: Bearer YOUR_REFRESH_SECRET"
```

Do not paste the real `REFRESH_SECRET` into committed documentation.
