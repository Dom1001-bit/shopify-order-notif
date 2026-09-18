// One-time helper: runs the Shopify OAuth install flow for a custom-
// distribution app and prints out the Admin API access token you need for
// .env. You only need to run this once per store (or again if you ever
// uninstall/reinstall the app).
//
// Usage:
//   1. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET in .env
//   2. node scripts/install.js
//   3. Add the printed redirect URL to your app's "Allowed redirection URL(s)"
//      in the Shopify Dev Dashboard if it's not there already, then open the
//      printed authorize URL and approve the install.

require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SCOPES = process.env.SHOPIFY_SCOPES || 'read_orders,write_orders';
const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Set SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env first.'
  );
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');

const authorizeUrl =
  `https://${SHOP}/admin/oauth/authorize` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&state=${state}`;

console.log('\n1. In the Shopify Dev Dashboard, add this exact redirect URL to your app');
console.log('   ("Allowed redirection URL(s)" under app setup / URLs):\n');
console.log(`   ${REDIRECT_URI}\n`);
console.log('2. Then open this URL in your browser and approve the install:\n');
console.log(`   ${authorizeUrl}\n`);
console.log(`Waiting for the redirect back to http://localhost:${PORT} ...`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const shop = url.searchParams.get('shop');

  if (returnedState !== state) {
    res.writeHead(400);
    res.end('State mismatch — possible CSRF attempt, aborting.');
    server.close();
    return;
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
      }),
    });
    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new Error(JSON.stringify(tokenJson));
    }

    console.log('\n✅ Install succeeded. Add these to your .env file:\n');
    console.log(`SHOPIFY_STORE_DOMAIN=${shop}`);
    console.log(`SHOPIFY_ADMIN_ACCESS_TOKEN=${tokenJson.access_token}\n`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success</h1><p>Access token printed in your terminal. You can close this tab.</p>');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.writeHead(500);
    res.end('Token exchange failed — check the terminal for details.');
  } finally {
    server.close();
  }
});

server.listen(PORT);
