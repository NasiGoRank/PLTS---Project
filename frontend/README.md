# PLTS monitoring frontend for Vercel

Vite/React dashboard that reads monitoring data from the Render backend:

```text
GET ${VITE_API_URL}/api/current
```

The browser does not connect to Supabase and must not receive a Supabase secret key.

## Requirements

Use Node.js 22.12 or newer within the Node 22 release line.

```bash
node --version
npm --version
```

With `nvm`:

```bash
nvm install 22
nvm use 22
```

The included `.npmrc` and `package-lock.json` use the public npm registry.

## Local run

```bash
npm ci
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env.local
```

The development build defaults to `http://localhost:8000` when `VITE_API_URL` is absent.

## If dependency installation stalls

Confirm the registry and retry with detailed output:

```bash
npm config get registry
npm ci --verbose
```

The registry should be:

```text
https://registry.npmjs.org/
```

For an older extracted copy that contains a broken lock file, delete `node_modules` and `package-lock.json`, then run `npm install` once to regenerate the lock file.

## Vercel deployment

Import the repository and set **Root Directory** to `frontend`.

```text
Framework: Vite
Build Command: npm run build
Output Directory: dist
Node.js Version: 22.x
```

Environment variables:

```text
VITE_API_URL=https://your-render-service.onrender.com
VITE_POLL_INTERVAL_MS=60000
```

Redeploy after changing Vercel environment variables. Then set the final Vercel origin in Render's `FRONTEND_ORIGIN` variable.

Anything prefixed with `VITE_` becomes public browser configuration. Never place passwords, cookies, or Supabase secret keys there.
