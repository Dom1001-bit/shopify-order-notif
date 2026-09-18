// Shopify retries webhook deliveries that don't get a fast 200 response, and
// can occasionally deliver the same event twice. This keeps an in-memory
// record of webhook IDs we've already handled so we don't post the same
// order to Slack more than once.
//
// NOTE: this is per-process memory. If you ever run more than one instance
// of this server behind a load balancer, swap this for a shared store
// (Redis, a database table, etc.) so instances agree on what's been seen.

const seen = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function markSeen(key) {
  const now = Date.now();

  for (const [existingKey, timestamp] of seen) {
    if (now - timestamp > TTL_MS) {
      seen.delete(existingKey);
    }
  }

  if (seen.has(key)) {
    return false; // already handled this one
  }

  seen.set(key, now);
  return true; // first time seeing it
}

module.exports = { markSeen };
