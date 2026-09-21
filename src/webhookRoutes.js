const config = require('./config');
const {
  verifyWebhookHmac,
  getOrderDetailsAndRisk,
  orderGidFromRestId,
  adminOrderUrl,
} = require('./shopify');
const { markSeen } = require('./dedupe');
const { buildOrderBlocks, isRiskPending } = require('./slack');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shopify computes fraud risk asynchronously, so the assessment often isn't
// ready the instant an order is created. Post immediately so the alert is
// never missed, then quietly refresh the same Slack message once the risk
// score comes in.
async function postOrderAlertWithRiskFollowup(slackClient, orderGid, restId) {
  const order = await getOrderDetailsAndRisk(orderGid);
  const url = adminOrderUrl(restId);
  const { blocks, text } = buildOrderBlocks(order, url);

  const posted = await slackClient.chat.postMessage({
    channel: config.slack.channelId,
    text,
    blocks,
  });

  if (!isRiskPending(order)) return;

  const retryDelaysMs = [15000, 60000];
  for (const delay of retryDelaysMs) {
    await sleep(delay);

    const refreshed = await getOrderDetailsAndRisk(orderGid);
    const { blocks: newBlocks, text: newText } = buildOrderBlocks(refreshed, url);

    await slackClient.chat.update({
      channel: config.slack.channelId,
      ts: posted.ts,
      text: newText,
      blocks: newBlocks,
    });

    if (!isRiskPending(refreshed)) break;
  }
}

function createOrdersCreateHandler(slackClient) {
  return async function handler(req, res) {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = req.body; // Buffer — see express.raw() in server.js

    if (!verifyWebhookHmac(rawBody, hmacHeader)) {
      return res.status(401).send('Invalid HMAC signature');
    }

    // Acknowledge fast. Shopify retries (and can page you about failures)
    // if it doesn't get a 200 quickly — the rest of the work happens after.
    res.status(200).send('ok');

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      console.error('Failed to parse Shopify webhook payload:', err);
      return;
    }

    const webhookId = req.get('X-Shopify-Webhook-Id') || `order-${payload.id}`;
    if (!markSeen(webhookId)) {
      console.log(`Duplicate webhook delivery ${webhookId} — already handled, skipping.`);
      return;
    }

    const restId = payload.id;
    const orderGid = orderGidFromRestId(restId);

    try {
      await postOrderAlertWithRiskFollowup(slackClient, orderGid, restId);
    } catch (err) {
      console.error(`Failed to process order ${restId}:`, err);
    }
  };
}

module.exports = { createOrdersCreateHandler };
