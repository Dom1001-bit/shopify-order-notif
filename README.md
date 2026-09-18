# Shopify → Slack order agent

Watches your Shopify store for new orders, posts a fraud-aware alert to a
Slack channel the moment one comes in (so it's never missed), and lets your
team add a note back onto the order straight from Slack.

**What it does:**
- Listens for Shopify's `orders/create` webhook.
- Posts the order (customer, total, shipping destination, payment status)
  to a Slack channel within moments of it being placed.
- Reads Shopify's own fraud-risk assessment for the order (the same
  Low/Medium/High signal you see in the Shopify admin) and highlights it in
  the alert, with Shopify's accept/investigate/cancel recommendation and the
  specific risk factors it flagged. Risk analysis is computed by Shopify
  slightly after order creation, so the agent posts immediately and quietly
  updates the same Slack message once the score is ready (checked at 15s and
  60s after the order comes in).
- Adds a **📝 Add note** button to each alert. Clicking it opens a small
  form in Slack; whatever your teammate types is written onto the order's
  notes in Shopify (with a timestamp and their name) and echoed back into
  the Slack thread — so "add a comment" works in both directions without
  anyone leaving Slack.
- Adds a **🔗 Open in Shopify** button that jumps straight to the order.

## How it's built

A small always-on Node.js/Express server, in plain JavaScript:

```
src/
  server.js          entry point — wires up the Express app + Slack bot
  config.js          reads and validates your .env
  shopify.js          Shopify GraphQL calls: read order + risk, write notes, verify webhook signatures
  slack.js            builds the Slack message, handles the "Add note" button + modal
  webhookRoutes.js     the /webhooks/shopify/orders-create handler (HMAC check, dedupe, risk follow-up)
  dedupe.js            in-memory guard against Shopify's occasional duplicate webhook deliveries
scripts/
  install.js           one-time OAuth helper to get your Shopify Admin API access token
  register-webhook.js  one-time helper to register the orders/create webhook against your deployed URL
```

You run this yourself (Render, Railway, Fly.io, a small VPS, etc. — anywhere
that can run a long-lived Node process on a public HTTPS URL). It's not a
Shopify App Store app; it's a private integration for your own store.

## 1. Create the Shopify app (source of your API access)

Shopify's older "Settings → Apps and sales channels → Develop apps" flow for
custom apps has been retired for *new* apps (existing ones still work). New
custom integrations are created in the **Dev Dashboard** instead:

1. Go to the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard) → **Create app** → **Start from Dev Dashboard** → name it → **Create**.
2. Open the **Versions** tab → **Create a version**. This one screen has
   *all* the URL fields together — fill in:
   - **App URL** — if you don't have a deployed URL yet,
     `https://shopify.dev/apps/default-app-home` works as a placeholder
     (change it once you deploy).
   - **Allowed redirection URL(s)** (may also show as "Redirect URL(s)") —
     add `http://localhost:8787/callback` here now, so `npm run
     install:shopify` works. Add your real deployed URL's `/callback` here
     too later if you ever need to re-run OAuth from the server itself.
   - **Scopes** — `read_orders`, `write_orders`.

   Click **Release**, then confirm with **Release** again.

   > Already released a version without setting the redirect URL? Go back
   > to **Versions** → **Create a version** again — it opens a new draft
   > pre-filled with your current settings — add the redirect URL there,
   > and **Release** it.
3. Go to the **Home** tab → **Install app** → select or create the store
   you want it on → **Install**. (This is the "custom distribution"
   step — installing straight from Dev Dashboard onto your own store,
   with no App Store review needed. If you don't see a Distribution card
   at all, that's fine — the Install app button on Home does the same
   thing for a single-store install.)
4. Go to the **Settings** tab and copy the **Client ID** and
   **Client secret** — you'll need both for the next step.

   > If your store *does* still have the legacy "Develop apps" page under
   > Settings → Apps and sales channels, you can use that instead: it gives
   > you a pre-generated Admin API access token directly (skip step 2 below)
   > plus a client secret on the same "API credentials" tab for webhook
   > verification.

## 2. Get your Admin API access token

```bash
cp .env.example .env
# fill in SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
npm install
npm run install:shopify
```

This starts a tiny local server, prints a Shopify install/authorize URL, and
walks you through OAuth. It'll remind you that
`http://localhost:8787/callback` needs to be in the app's **Allowed
redirection URL(s)** — if you already added that in step 1.2 above, you're
set; if not, go do that now (Dev Dashboard → your app → **Versions** →
**Create a version** → add it under Allowed redirection URL(s) → **Release**),
then re-run `npm run install:shopify`. Once you approve the install in your
browser, it prints `SHOPIFY_ADMIN_ACCESS_TOKEN=...` — copy that into `.env`.

## 3. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **OAuth & Permissions** → add these Bot Token Scopes: `chat:write`, `users:read`.
3. **Install App** to your workspace → copy the **Bot User OAuth Token**
   (`xoxb-...`) into `SLACK_BOT_TOKEN`.
4. **Basic Information** → copy the **Signing Secret** into `SLACK_SIGNING_SECRET`.
5. **Interactivity & Shortcuts** → turn it on → set the **Request URL** to
   `https://<your-deployed-domain>/slack/events` (you'll fill this in once
   deployed — see step 5). You can come back and set this after you deploy.
6. Invite the bot to the channel you want alerts in
   (`/invite @your-bot-name`), then get that channel's ID: right-click the
   channel → **View channel details** → scroll down → copy the Channel ID
   (starts with `C`) into `SLACK_CHANNEL_ID`.

## 4. Finish `.env`

Double check every value in `.env` against `.env.example` is filled in,
including `SHOPIFY_API_VERSION` (defaults to `2026-01` — bump this
periodically; Shopify API versions are supported for about a year).

## 5. Deploy

Push this folder to whatever host you like (Render, Railway, Fly.io, a VPS
with `pm2`, etc.) with `npm start` as the run command and your `.env` values
set as environment variables there. Note the public HTTPS URL it gives you
— e.g. `https://shopify-order-agent.onrender.com`.

Then:
- Go back to the Slack app's **Interactivity & Shortcuts** and set the
  Request URL to `<that URL>/slack/events`.
- Register the Shopify webhook against it:

  ```bash
  npm run register:webhook -- https://shopify-order-agent.onrender.com
  ```

**Testing locally first:** run `npm run dev` and expose it with a tool like
`ngrok http 3000`, use the `https://*.ngrok-free.app` URL for both the Slack
Request URL and `register-webhook.js` while you test, then swap to your real
deployed URL when you go live.

## 6. Try it

Place a test order in your store (Shopify has a "Bogus Gateway" test payment
method you can enable for exactly this). Within a couple seconds you should
see the alert in Slack, with the risk assessment filling in shortly after.
Click **Add note**, type something, submit — check the order in Shopify
admin and you'll see it appended to the order notes, and a confirmation
reply in the Slack thread.

## Notes & limitations

- **Single instance only, as written.** Duplicate-webhook protection and
  the pending-risk retry both live in memory. If you ever run more than one
  instance behind a load balancer, swap `src/dedupe.js` for a shared store
  (Redis, a database row) so instances agree on what they've already
  handled.
- **Fraud detection is Shopify's own risk assessment** — the same
  Low/Medium/High score and facts you'd see on the order page in Shopify
  admin, surfaced in Slack rather than reimplemented. If you later want
  extra custom rules on top (address mismatches, order velocity, disposable
  emails, etc.), that logic would slot into `src/shopify.js`'s
  `getOrderDetailsAndRisk` result before it's handed to `buildOrderBlocks`.
- **Notes are appended, not threaded per-line in Shopify** — Shopify's order
  `note` field is a single text field, so each Slack-added note is appended
  as a new timestamped line rather than a separate discrete comment object
  (Shopify's Admin API doesn't expose arbitrary custom order-timeline
  comments to apps).
- Shopify retries webhook deliveries that don't get a fast response, which
  is why the handler responds `200` immediately and does the Shopify/Slack
  work afterward.
