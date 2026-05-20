const express = require('express');
const crypto = require('crypto');
const simpleParser = require('mailparser').simpleParser;
const router = express.Router();
const queries = require('../db/queries');

/**
 * @swagger
 * /inbound:
 *   post:
 *     summary: Webhook to receive raw email from Cloudflare Worker
 *     tags: [Inbound]
 *     security:
 *       - api_key: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               to:
 *                 type: string
 *               from:
 *                 type: string
 *               raw:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email processed
 *       401:
 *         description: Unauthorized
 */
router.post('/', async (req, res) => {
  // Verify secret
  const secret = req.headers['x-inbound-secret'];
  if (!process.env.INBOUND_SECRET || secret !== process.env.INBOUND_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { to, from, raw } = req.body;
  if (!to || !raw) {
    return res.status(400).json({ error: 'Missing to or raw email data' });
  }

  try {
    // Parse raw email
    const parsed = await simpleParser(raw);
    
    // Determine address and domain
    // to usually looks like "name@domain.com" or "Some Name <name@domain.com>"
    let address = to.toLowerCase();
    const match = address.match(/<([^>]+)>/);
    if (match) {
      address = match[1];
    }
    
    const domainPart = address.split('@')[1];
    if (!domainPart) {
      return res.status(400).json({ error: 'Invalid recipient address' });
    }

    const id = crypto.randomUUID();
    const now = new Date();
    
    let expiresAtStr = '';
    const mailbox = queries.getMailbox.get({ address });
    if (mailbox) {
      expiresAtStr = mailbox.expires_at;
      // If mailbox is already expired, we do not store the email (reject it)
      if (new Date(expiresAtStr) <= now) {
        console.log(`[Inbound] Rejected email for expired mailbox: ${address}`);
        return res.status(410).json({ error: 'Mailbox has expired' });
      }
    } else {
      // Auto-register unregistered direct recipient using EMAIL_TTL_HOURS,
      // capped at 6 h so it can't exceed the explicit-duration upper bound.
      const hours = parseFloat(process.env.EMAIL_TTL_HOURS || '1');
      let minutes = isNaN(hours) ? 60 : hours * 60;
      if (minutes < 5) minutes = 5;
      if (minutes > 360) minutes = 360;
      const expiresAt = new Date(now.getTime() + minutes * 60 * 1000);
      expiresAtStr = expiresAt.toISOString();
      queries.insertMailbox.run({
        address,
        created_at: now.toISOString(),
        expires_at: expiresAtStr
      });
    }

    console.log(`[Inbound] Parsed email: subj="${parsed.subject}", bodyTextLen=${parsed.text?.length || 0}, bodyHtmlLen=${parsed.html?.length || 0}`);

    queries.insertEmail.run({
      id,
      address,
      domain: domainPart,
      from_addr: parsed.from?.value?.[0]?.address || from || '',
      from_name: parsed.from?.value?.[0]?.name || '',
      subject: parsed.subject || '(No Subject)',
      body_text: parsed.text || '',
      body_html: parsed.html || '',
      raw: raw,
      received_at: now.toISOString(),
      expires_at: expiresAtStr
    });

    res.json({ success: true, id });
  } catch (err) {
    console.error('Error processing inbound email:', err);
    res.status(500).json({ error: 'Failed to process email' });
  }
});

module.exports = router;
