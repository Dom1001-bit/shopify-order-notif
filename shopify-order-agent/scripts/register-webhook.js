// One-time helper: registers the orders/create webhook subscription on your
// store, pointing it at this app's deployed URL.
//
// Usage (after deploying, or once you have a public HTTPS tunnel for testing):
//   node scripts/register-webhook.js https://your-app.example.com
// or set APP_BASE_URL in .env and just run:
//   node scripts/register-webhook.js

require('dotenv').config();

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const CALLBACK_BASE = process.argv[2] || process.env.APP_BASE_URL;

if (!SHOP || !TOKEN) {
  console.error(
    'Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN in .env first ' +
      '(run `npm run install:shopify` if you have not already).'
  );
  process.exit(1);
}

if (!CALLBACK_BASE) {
  console.error(
    'Pass your deployed HTTPS base URL as an argument, e.g.\n' +
      '  node scripts/register-webhook.js https://your-app.example.com\n' +
      'or set APP_BASE_URL in .env.'
  );
  process.exit(1);
}

const uri = `${CALLBACK_BASE.replace(/\/$/, '')}/webhooks/shopify/orders-create`;

const mutation = `
  mutation registerOrdersCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

(async () => {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        topic: 'ORDERS_CREATE',
        webhookSubscription: { uri, format: 'JSON' },
      },
    }),
  });

  const json = await res.json();
  const result = json.data && json.data.webhookSubscriptionCreate;

  if (!result || (result.userErrors && result.userErrors.length)) {
    console.error('Failed to register webhook:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log('✅ Webhook registered:', result.webhookSubscription);
  console.log('\nNew orders will now be sent to:', uri);
})();
