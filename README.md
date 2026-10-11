# Get Web Health

A standalone web app for email/password accounts and scheduled backend health checks. Supabase provides Auth, private user data, Cron, and an Edge Function. The frontend is static and can be hosted on GitHub Pages, Render Static Sites, or another static host.

## Your existing project

The database, `health-worker`, private scheduler secret, minute-by-minute Cron, and history cleanup are already installed in project `ywkeuvdhtrmhtsugbntj`. Do not rerun database or scheduler installation for this project. The worker was verified with HTTP 200 and a real scheduler heartbeat. No backend endpoints have been added yet.

The private preview is https://get-web-health.greyhinny.chatgpt.site. It requires ChatGPT access before the app's own Supabase login. For a publicly accessible demo, deploy `dist/` using the hosting instructions below and update Supabase's Site URL and allowed redirect URLs to that public URL.

Custom SMTP is currently disabled in your Supabase project. Configure an SMTP provider for confirmation and recovery emails to public users. Live signup email delivery has not been tested.

## Features

- Email/password signup, login, email confirmation, password reset, and logout.
- Add, edit, search, pause, resume, and delete backend endpoints.
- Select 5, 10, 15, 30, or 60-minute intervals; 10 minutes is the default.
- Real HTTP status, response timing, recent success rate, and check history.
- Cloud checks continue after the browser closes.
- Row Level Security and column permissions isolate each user's records and stop users from forging check results.
- Up to 10 endpoints per account; history is retained for 7 days.

## 1. Install and build the frontend

Use Node.js 22+ and pnpm. The pinned dependencies and pnpm lockfile are included.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open http://127.0.0.1:4173. `dist/` is the deployable static folder. No server is needed for the frontend.

Your supplied project URL and publishable key are already configured as browser-safe defaults in `scripts/build.mjs`. To use another project, copy `.env.example` to `.env` and set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never put a secret or service-role key into frontend environment variables. The builder rejects these privileged keys.

## 2. Create the database tables

Open your Supabase project's SQL Editor and run `supabase/setup.sql` **once**. It creates only this app's tables and functions. It does not drop existing tables. Existing objects with the same names cause an error instead of being silently replaced.

The SQL explicitly grants the required Data API permissions and enables ownership policies. Users can write monitor names, URLs, intervals, and enabled state; check results and scheduler timestamps can only be written by the internal worker.

## 3. Configure authentication redirects

In **Authentication > URL Configuration**, set the Site URL to your deployed frontend URL. Add the exact deployed URL and `http://127.0.0.1:4173` to Redirect URLs. Include a repository subpath when hosting on GitHub Pages. Email/password signup must be enabled. Email confirmation is supported; users see a confirmation instruction when they register.

For public signups, configure your own SMTP service if Supabase's default email service restricts recipients or rate limits. Do not disable confirmation merely to conceal a delivery error.

## 4. Deploy the cloud checker

The Edge Function is `supabase/functions/health-worker/index.ts`. It imports its shared helper from `supabase/functions/_shared/endpoint.js`; deploy the whole function with its dependency rather than pasting only `index.ts`. The build also generates `supabase/dashboard-worker.js`, a single-file version you can paste into the Supabase dashboard Edge Function editor. Name the function `health-worker` and turn off its gateway JWT verification because it performs its own user/cron authentication.

Install the official Supabase CLI, then use its `--help` output for the current login, link, secret-setting, and function-deployment syntax. Link the CLI to project reference `ywkeuvdhtrmhtsugbntj`.

Deploy the function as `health-worker`, using this project's `supabase/config.toml`. Its gateway JWT check is off because it has two callers: authenticated users and a server-side Cron job. The function itself verifies user access tokens with `auth.getUser`, verifies ownership, and accepts Cron only with the private `x-cron-secret` header. A publishable key alone does not authorize it.

Generate a long random `HEALTH_CRON_SECRET` and save it as a Supabase Edge Function secret. Do not send it to the browser or commit it. Supabase supplies the internal service-role environment credentials to deployed functions; those credentials remain server-side.

Supported hosts by default: subdomains of `onrender.com`, `up.railway.app`, `fly.dev`, `vercel.app`, and `workers.dev`. For your own custom HTTPS domain, set the `ALLOWED_HEALTH_HOSTS` Edge Function secret to a comma-separated list of exact hostnames you trust. Do not allow a hostname that resolves to internal infrastructure.

Only HTTPS on port 443 is allowed. Local addresses and credentials in URLs are rejected. Redirects are limited and each destination must pass the same host checks. Requests time out after 85 seconds and response bodies are not retained.

## 5. Enable background scheduling

Replace the single placeholder in `supabase/schedule.sql` with the **same** `HEALTH_CRON_SECRET` in your SQL Editor; do not save the edited secret into your repository. Run this schedule setup once. It stores the secret in Supabase Vault and schedules a worker invocation every minute. The worker only claims endpoints whose selected interval has elapsed.

Check the queries at the bottom of the file after the first minute. The dashboard shows scheduler connectivity from `scheduler_status.last_run_at`, not from a simulated status. A saved endpoint stays pending until a real check completes. Old successes become overdue when checks stop arriving.

The function claims at most five endpoints per invocation and checks them concurrently. Worker leases prevent duplicate checks. Manual checks are limited to once per endpoint per minute. A paused schedule can still be checked manually.

## Hosting

On Render, choose **Static Site** (not Web Service), build command `pnpm install --frozen-lockfile && pnpm build`, publish directory `dist`. Set the two `PUBLIC_SUPABASE_*` variables only if changing the defaults.

For GitHub Pages, a deployment workflow is included at `.github/workflows/deploy.yml`. Upload this app as a separate repository, enable Pages with **GitHub Actions** as its source, and run the workflow on the default branch. All asset links are relative for repository subpaths.

The frontend can be hosted on a free static tier and does not need to stay awake. Supabase Free usage and availability limits still apply; paused Supabase projects cannot run checks. Scheduled requests also do not guarantee Render uptime or persistent uploads. Monitor the actual usage before scaling beyond a small demo.

## Verification

```sh
pnpm test
pnpm build
```

The tests run the actual database setup against embedded PostgreSQL with Supabase-style roles, test account isolation, column privileges, worker leases, and result history. Endpoint tests cover URL validation, redirects, success/failure, and stale status. Live signup and cloud scheduling additionally require the Supabase setup steps above.

## Layout

```
src/                         frontend UI
scripts/                     static build and preview
supabase/setup.sql           tables, RLS, worker RPCs
supabase/schedule.sql        Cron and Vault setup
supabase/functions/          cloud checker and shared logic
tests/                       database and endpoint verification
dist/                        generated deployable frontend
```

Docs: https://supabase.com/docs/guides/auth/passwords · https://supabase.com/docs/guides/functions/schedule-functions · https://supabase.com/docs/guides/database/postgres/row-level-security
