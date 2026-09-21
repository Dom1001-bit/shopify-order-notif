const crypto = require('crypto');
const config = require('./config');

const GRAPHQL_URL = `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}/graphql.json`;

/**
 * Verifies a Shopify webhook's HMAC signature.
 * Shopify signs the raw (unparsed) request body with your app's client
 * secret and sends the result, base64-encoded, in X-Shopify-Hmac-Sha256.
 * https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
 */
function verifyWebhookHmac(rawBody, hmacHeader) {
  if (!hmacHeader || !rawBody) return false;

  const digest = crypto
    .createHmac('sha256', config.shopify.clientSecret)
    .update(rawBody)
    .digest('base64');

  const digestBuf = Buffer.from(digest, 'utf8');
  const headerBuf = Buffer.from(hmacHeader, 'utf8');

  if (digestBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(digestBuf, headerBuf);
}

async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.shopify.adminAccessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`Shopify GraphQL request failed (${res.status}): ${JSON.stringify(json)}`);
  }

  if (json.errors && json.errors.length) {
    // Log so it's visible in your host's logs, but don't abort if we still
    // got usable data back (GraphQL can return partial data + errors, e.g.
    // one field blocked by a missing access scope while the rest succeeds).
    console.error('Shopify GraphQL returned errors:', JSON.stringify(json.errors));
    if (!json.data) {
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
    }
  }

  return json.data;
}

// NOTE: intentionally does NOT request order.customer{...} — that requires
// the read_customers scope, which this app doesn't request (kept to the
// minimum: read_orders, write_orders). order.email below covers the
// customer's contact email without needing that extra scope.
const ORDER_RISK_QUERY = `
  query GetOrderRisk($id: ID!) {
    order(id: $id) {
      id
      name
      note
      email
      createdAt
      displayFinancialStatus
      totalPriceSet {
        shopMoney { amount currencyCode }
      }
      shippingAddress {
        city
        provinceCode
        countryCodeV2
      }
      risk {
        recommendation
        assessments {
          riskLevel
          provider { title }
          facts { description sentiment }
        }
      }
    }
  }
`;

// Fetches the order plus Shopify's fraud-risk assessment for it.
// Risk analysis is computed asynchronously by Shopify, so right after an
// order is created this can come back with an empty/PENDING assessment.
async function getOrderDetailsAndRisk(orderGid) {
  const data = await shopifyGraphQL(ORDER_RISK_QUERY, { id: orderGid });
  if (!data.order) {
    throw new Error(`Order ${orderGid} not found (it may have been deleted).`);
  }
  return data.order;
}

const ORDER_NOTE_MUTATION = `
  mutation UpdateOrderNote($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id note }
      userErrors { field message }
    }
  }
`;

// Appends a timestamped line to the order's note field rather than
// overwriting it, so notes added from Slack build up as a log.
async function appendOrderNote(orderGid, addedText) {
  const current = await shopifyGraphQL(
    `query GetNote($id: ID!) { order(id: $id) { note } }`,
    { id: orderGid }
  );
  const existingNote = (current.order && current.order.note) || '';
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${addedText}`;
  const newNote = existingNote ? `${existingNote}\n${line}` : line;

  const data = await shopifyGraphQL(ORDER_NOTE_MUTATION, {
    input: { id: orderGid, note: newNote },
  });

  const errors = data.orderUpdate.userErrors;
  if (errors && errors.length) {
    throw new Error(`Shopify rejected the note update: ${JSON.stringify(errors)}`);
  }

  return data.orderUpdate.order.note;
}

function orderGidFromRestId(restId) {
  return `gid://shopify/Order/${restId}`;
}

function restIdFromGid(gid) {
  const match = /\/Order\/(\d+)/.exec(gid || '');
  return match ? match[1] : null;
}

function adminOrderUrl(restId) {
  const shopHandle = config.shopify.storeDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${shopHandle}/orders/${restId}`;
}

module.exports = {
  verifyWebhookHmac,
  getOrderDetailsAndRisk,
  appendOrderNote,
  orderGidFromRestId,
  restIdFromGid,
  adminOrderUrl,
};
