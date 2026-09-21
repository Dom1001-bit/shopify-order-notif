require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env file against .env.example.`
    );
  }
  return value;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  shopify: {
    // e.g. your-store.myshopify.com
    storeDomain: required('SHOPIFY_STORE_DOMAIN'),
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-01',
    adminAccessToken: required('SHOPIFY_ADMIN_ACCESS_TOKEN'),
    // Also doubles as the webhook HMAC signing secret.
    clientSecret: required('SHOPIFY_CLIENT_SECRET'),
  },

  slack: {
    botToken: required('SLACK_BOT_TOKEN'),
    signingSecret: required('SLACK_SIGNING_SECRET'),
    channelId: required('SLACK_CHANNEL_ID'),
  },
};

module.exports = config;
