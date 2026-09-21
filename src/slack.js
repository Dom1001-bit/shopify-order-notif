const { appendOrderNote } = require('./shopify');

const RISK_LABELS = {
  HIGH: '🔴 *High risk*',
  MEDIUM: '🟠 *Medium risk*',
  LOW: '🟢 *Low risk*',
  PENDING: '⏳ *Calculating…*',
  NONE: '⚪ *No risk signal*',
};

const RECOMMENDATION_LABELS = {
  CANCEL: '🛑 Shopify recommends *cancelling* this order',
  INVESTIGATE: '🔎 Shopify recommends *investigating* this order',
  ACCEPT: '✅ Shopify recommends fulfilling this order',
  NONE: 'No specific recommendation from Shopify',
};

// HIGH is worse than MEDIUM is worse than LOW, etc. Used to pick the single
// worst assessment to headline when Shopify (or a fraud app) returns more than one.
const SEVERITY_ORDER = ['HIGH', 'MEDIUM', 'LOW', 'PENDING', 'NONE'];

function worstAssessment(assessments) {
  if (!assessments || !assessments.length) return null;
  return assessments.reduce((worst, current) => {
    if (!worst) return current;
    return SEVERITY_ORDER.indexOf(current.riskLevel) < SEVERITY_ORDER.indexOf(worst.riskLevel)
      ? current
      : worst;
  }, null);
}

function isRiskPending(order) {
  const assessments = order.risk && order.risk.assessments;
  return !assessments || !assessments.length || assessments.every((a) => a.riskLevel === 'PENDING');
}

function slackDate(isoString) {
  const ts = Math.floor(new Date(isoString).getTime() / 1000);
  // Slack renders this in each viewer's own local timezone.
  return `<!date^${ts}^{date_short_pretty} at {time}|${isoString}>`;
}

function buildOrderBlocks(order, adminUrl) {
  const risk = order.risk || { recommendation: 'NONE', assessments: [] };
  const worst = worstAssessment(risk.assessments);
  const riskLevel = worst ? worst.riskLevel : 'NONE';

  const money = order.totalPriceSet && order.totalPriceSet.shopMoney;
  const total = money ? `${money.amount} ${money.currencyCode}` : 'n/a';
  // order.email is the order's contact email and doesn't need any extra
  // access scope (unlike order.customer, which needs read_customers).
  const customerEmail = order.email || 'n/a (guest checkout)';
  const shipping = order.shippingAddress
    ? [order.shippingAddress.city, order.shippingAddress.provinceCode, order.shippingAddress.countryCodeV2]
        .filter(Boolean)
        .join(', ')
    : 'n/a';

  const facts = (worst && worst.facts ? worst.facts : [])
    .slice(0, 3)
    .map((f) => `${f.sentiment === 'NEGATIVE' ? '⚠️' : '•'} ${f.description}`)
    .join('\n');

  const riskText = [
    RISK_LABELS[riskLevel] || `❔ ${riskLevel}`,
    RECOMMENDATION_LABELS[risk.recommendation] || risk.recommendation,
    facts,
  ]
    .filter(Boolean)
    .join('\n');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🛒 New order ${order.name}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Customer email:*\n${customerEmail}` },
        { type: 'mrkdwn', text: `*Total:*\n${total}` },
        { type: 'mrkdwn', text: `*Payment status:*\n${order.displayFinancialStatus || 'n/a'}` },
        { type: 'mrkdwn', text: `*Ships to:*\n${shipping}` },
        { type: 'mrkdwn', text: `*Placed:*\n${slackDate(order.createdAt)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: riskText },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📝 Add note', emoji: true },
          action_id: 'open_add_note_modal',
          value: JSON.stringify({ orderGid: order.id, orderName: order.name }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔗 Open in Shopify', emoji: true },
          url: adminUrl,
        },
      ],
    },
  ];

  const plainRiskLevel = (RISK_LABELS[riskLevel] || riskLevel).replace(/\*/g, '');
  const text = `New order ${order.name} — ${total} — ${plainRiskLevel}`;

  return { blocks, text };
}

// Wires up the "Add note" button -> modal -> Shopify order note flow.
function registerSlackHandlers(slackApp) {
  slackApp.action('open_add_note_modal', async ({ ack, body, client }) => {
    await ack();

    const { orderGid, orderName } = JSON.parse(body.actions[0].value);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'submit_order_note',
        private_metadata: JSON.stringify({
          orderGid,
          orderName,
          channel: body.channel.id,
          messageTs: body.message.ts,
        }),
        title: { type: 'plain_text', text: `Note: ${orderName}`.slice(0, 24) },
        submit: { type: 'plain_text', text: 'Add note' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'note_block',
            label: { type: 'plain_text', text: 'Note to add to this order' },
            element: {
              type: 'plain_text_input',
              action_id: 'note_input',
              multiline: true,
            },
          },
        ],
      },
    });
  });

  slackApp.view('submit_order_note', async ({ ack, view, body, client }) => {
    await ack();

    const meta = JSON.parse(view.private_metadata);
    const noteText = view.state.values.note_block.note_input.value;

    let author = body.user.id;
    try {
      const info = await client.users.info({ user: body.user.id });
      author = (info.user && (info.user.real_name || info.user.name)) || author;
    } catch (err) {
      // Non-fatal — fall back to the raw user ID.
    }

    try {
      await appendOrderNote(meta.orderGid, `${noteText} — via Slack by ${author}`);
      await client.chat.postMessage({
        channel: meta.channel,
        thread_ts: meta.messageTs,
        text: `:memo: *${author}* added a note to ${meta.orderName}:\n>${noteText}`,
      });
    } catch (err) {
      await client.chat.postMessage({
        channel: meta.channel,
        thread_ts: meta.messageTs,
        text: `:warning: Couldn't save that note to Shopify for ${meta.orderName}: ${err.message}`,
      });
    }
  });
}

module.exports = { buildOrderBlocks, registerSlackHandlers, isRiskPending };
