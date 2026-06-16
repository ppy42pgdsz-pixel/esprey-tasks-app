# Deployment Guide — esprey-tasks-app

## Prerequisites
- Wrangler CLI installed: `npm install -g wrangler`
- Logged in: `wrangler login` (use the Cloudflare account `Cesprey@yahoo.com`)
- Node.js 18+

---

## Step 1: Create a GitHub repo

1. Go to github.com → New repository
2. Name it `esprey-tasks-app` (keep it separate from `esprey-expenses-app`)
3. Push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "initial"
   git remote add origin https://github.com/YOUR_USERNAME/esprey-tasks-app.git
   git push -u origin main
   ```

---

## Step 2: Create the D1 database

```bash
wrangler d1 create esprey-tasks-app
```

Copy the `database_id` from the output and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in both:
- `wrangler.toml`
- `email-worker/wrangler.toml`

Then run the migration:
```bash
wrangler d1 execute esprey-tasks-app --file=./migrations/0001_initial.sql
```

---

## Step 3: Deploy the Pages app

1. Go to **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**
2. Select your `esprey-tasks-app` repo
3. Settings:
   - **Project name**: `esprey-tasks-app`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Click **Save and Deploy**

After first deploy, go to **Settings → Environment Variables** and add:
| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

Then go to **Settings → Functions → D1 database bindings** and add:
| Variable name | D1 database |
|---|---|
| `DB` | `esprey-tasks-app` |

Redeploy to pick up the bindings.

---

## Step 4: Add custom domain

1. In the Pages project → **Custom domains → Add custom domain**
2. Enter `tasks.esprey.net`
3. Cloudflare will add the CNAME automatically (it's already on Cloudflare DNS)

---

## Step 5: Set up Cloudflare Access (auth gate)

1. Go to **Zero Trust → Access → Applications → Add an application**
2. Choose **Self-hosted**
3. Settings:
   - **Application name**: Esprey Tasks
   - **Subdomain**: `tasks` / **Domain**: `esprey.net`
4. For the policy, create a new one:
   - **Policy name**: Carl Only
   - **Action**: Allow
   - **Rule**: Emails → `cesprey@gmail.com`
5. Save

This protects `tasks.esprey.net` — only you can log in.

---

## Step 6: Deploy the email worker

```bash
cd email-worker
npm install
wrangler deploy
```

Go to Cloudflare Dashboard → Workers & Pages → `esprey-tasks-email` → Settings → Variables → add:
| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (secret) |

---

## Step 7: Set up Email Routing for tasks@esprey.net

1. Go to **Cloudflare Dashboard → Email → Email Routing → Routing Rules**
2. Add a **Custom address** rule:
   - **Custom address**: `tasks`
   - **Action**: Send to a Worker
   - **Worker**: `esprey-tasks-email`
3. Save

> ⚠️ This creates a new routing rule only for `tasks@esprey.net`. It does NOT touch the existing `receipts@esprey.net` rule.

---

## Step 8: Verify everything

1. Open `tasks.esprey.net` — you should be prompted to log in via Cloudflare Access
2. After login, the task list should appear (empty)
3. Click **+ Add Task** and create a test task
4. Forward any email to `tasks@esprey.net` — within a few seconds it should appear in the list
5. Open the email task → click **Generate** to draft a reply

---

## What NOT to touch (expenses app safeguards)

- Do NOT modify the `receipts@esprey.net` Email Routing rule
- Do NOT modify the `esprey-expenses-app` Pages project or `esprey-expenses-email` Worker
- Do NOT modify the `esprey-expenses-app` D1 database or `esprey-expenses-app-receipts` R2 bucket
- Do NOT touch the existing DKIM/SPF/DMARC/MX records (Resend depends on them)

---

## Local development

```bash
npm install
npm run dev        # Vite dev server at localhost:5173 (no auth, no DB)
```

For local API testing with D1:
```bash
wrangler pages dev dist --d1 DB=esprey-tasks-app
```
