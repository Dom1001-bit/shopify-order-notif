const express = require('express');
const { App: SlackApp, ExpressReceiver } = require('@slack/bolt');

const config = require('./config');
const { createOrdersCreateHandler } = require('./webhookRoutes');
const { registerSlackHandlers } = require('./slack');

// ExpressReceiver's own body-parsing/signature-verification middleware is
// scoped to its `endpoints` path (/slack/events), so it's safe to attach our
// own raw-body Shopify webhook route to the same underlying Express app.
const receiver = new ExpressReceiver({
  signingSecret: config.slack.signingSecret,
  endpoints: '/slack/events',
});

const slackApp = new SlackApp({
  token: config.slack.botToken,
  receiver,
});

registerSlackHandlers(slackApp);

const expressApp = receiver.app;

expressApp.get('/healthz', (req, res) => res.status(200).send('ok'));

// Shopify's HMAC check needs the exact raw bytes of the body, so this route
// gets express.raw() instead of the usual express.json().
expressApp.post(
  '/webhooks/shopify/orders-create',
  express.raw({ type: 'application/json', limit: '5mb' }),
  createOrdersCreateHandler(slackApp.client)
);

(async () => {
  await slackApp.start(config.port);
  console.log(`⚡️ Shopify order agent listening on port ${config.port}`);
  console.log(`   Shopify webhook URL: POST /webhooks/shopify/orders-create`);
  console.log(`   Slack events URL:    POST /slack/events`);
})();
