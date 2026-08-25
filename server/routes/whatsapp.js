'use strict';

const { Router } = require('../lib/router');

const router = new Router();

// Meta WhatsApp webhook verification
router.get('/api/whatsapp/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === 'subscribe' &&
    expectedToken &&
    token === expectedToken
  ) {
    res.statusCode = 200;
    res.setHeader(
      'Content-Type',
      'text/plain; charset=utf-8'
    );

    return res.end(challenge || '');
  }

  res.statusCode = 403;
  res.setHeader(
    'Content-Type',
    'text/plain; charset=utf-8'
  );

  res.end('Forbidden');
});

// Receive WhatsApp events
router.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const body = req.body || {};

    console.log(
      'WhatsApp webhook event:',
      JSON.stringify(body)
    );

    res.statusCode = 200;
    res.setHeader(
      'Content-Type',
      'application/json; charset=utf-8'
    );

    return res.end(
      JSON.stringify({
        received: true
      })
    );
  } catch (err) {
    console.error(
      'WhatsApp webhook error:',
      err
    );

    return res.error(
      500,
      'Webhook processing failed'
    );
  }
});

module.exports = router;